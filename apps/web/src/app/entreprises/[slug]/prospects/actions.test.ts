import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, prospects } from '@/db/schema';
import { creerScript } from '@/lib/entreprises';
import { importerFiches, modifierProspect } from '@/lib/prospects';
import { entrepriseDeTest, fiche, opposer } from '../../../../../test/fixtures';
import { avecBaseDeTest } from '../../../../../test/outils';

const etat = vi.hoisted(() => ({ operateur: true, revalidations: [] as string[] }));
vi.mock('@/lib/garde', () => ({ exigerOperateur: async () => {
  if (!etat.operateur) throw new Error('accès réservé à l’opérateur');
  return 'operateur@example.com';
} }));
vi.mock('next/cache', () => ({ revalidatePath: (chemin: string) => void etat.revalidations.push(chemin) }));

const { enregistrerProspect } = await import('./actions');
avecBaseDeTest();
beforeEach(() => { etat.operateur = true; etat.revalidations = []; });

async function saisie() {
  const e = await entrepriseDeTest();
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
  const [p] = await db.select().from(prospects);
  const donnees = new FormData();
  for (const cle of ['nom', 'societe', 'role', 'telephone', 'email', 'contexte'] as const) donnees.set(cle, p![cle] ?? '');
  donnees.set('connu', p!.majLe.toISOString());
  return { e, p: p!, donnees };
}

describe('modifier une fiche depuis l’interface', () => {
  it('enregistre tous les champs, normalise le téléphone et garde l’historique', async () => {
    const { e, donnees } = await saisie();
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const [appel] = await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine' }).returning();
    Object.entries({ nom: 'Julie Corrigée', societe: '', role: 'Gérante', telephone: '06 39 98 00 02', email: 'julie@example.com', contexte: 'Contexte corrigé.' }).forEach(([cle, valeur]) => donnees.set(cle, valeur));

    expect(await enregistrerProspect(e.id, 'julie', null, donnees)).toMatchObject({ ok: true });
    expect((await db.select().from(prospects))[0]).toMatchObject({ id: 'julie', nom: 'Julie Corrigée', societe: null, role: 'Gérante', telephone: '+33639980002', email: 'julie@example.com', contexte: 'Contexte corrigé.' });
    expect((await db.select().from(appels))[0]).toMatchObject({ id: appel!.id, numero: '+33639980001' });
    expect(etat.revalidations).toContain('/entreprises');
  });

  it('préserve une modification concurrente et permet de choisir explicitement d’écraser', async () => {
    const { e, donnees } = await saisie();
    await modifierProspect(e.id, 'julie', { contexte: 'Contexte réimporté.' });
    donnees.set('role', 'Gérante');
    const r = await enregistrerProspect(e.id, 'julie', null, donnees);
    expect(r).toMatchObject({ conflit: { jeton: expect.any(String) } });
    expect((await db.select().from(prospects))[0]?.contexte).toBe('Contexte réimporté.');
    expect(etat.revalidations).toEqual([]);
    donnees.set('ecraser', r!.conflit!.jeton);
    expect(await enregistrerProspect(e.id, 'julie', r, donnees)).toMatchObject({ ok: true });
  });

  it('refuse les numéros opposés, les fiches invalides et une référence absente', async () => {
    const { e, p, donnees } = await saisie();
    await opposer('+33639980009');
    donnees.set('telephone', '06 39 98 00 09');
    expect(await enregistrerProspect(e.id, 'julie', null, donnees)).toMatchObject({ message: expect.stringContaining('effacée') });
    donnees.set('telephone', p.telephone);
    donnees.set('email', 'adresse invalide');
    expect(await enregistrerProspect(e.id, 'julie', null, donnees)).toMatchObject({ message: expect.stringContaining('email invalide') });
    donnees.delete('connu');
    expect(await enregistrerProspect(e.id, 'julie', null, donnees)).toMatchObject({ message: expect.stringContaining('Relis') });
    expect((await db.select().from(prospects))[0]).toMatchObject({ telephone: p.telephone, email: null });
    expect(etat.revalidations).toEqual([]);
  });

  it('refuse un autre prospect ou un accès hors opérateur', async () => {
    const { e, donnees } = await saisie();
    donnees.set('role', 'Gérante');
    const autre = await entrepriseDeTest('Autre entreprise fictive', 'autre-fictive');
    expect(await enregistrerProspect(autre.id, 'julie', null, donnees)).toMatchObject({ message: expect.stringContaining('n’existe pas') });
    etat.operateur = false;
    await expect(enregistrerProspect(e.id, 'julie', null, donnees)).rejects.toThrow('réservé à l’opérateur');
    expect((await db.select().from(prospects).where(eq(prospects.entrepriseId, e.id)))[0]?.role).toBeNull();
  });
});
