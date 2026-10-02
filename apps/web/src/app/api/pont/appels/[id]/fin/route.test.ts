import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { appelerSuivantTelephone, demarrerCampagne, enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { listerAppels } from '@/lib/lecture';
import { importerFiches } from '@/lib/prospects';
import { fauxPont } from '../../../../../../../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../../../../../../../test/fixtures';
import { avecBaseDeTest } from '../../../../../../../test/outils';
import { POST } from './route';

// Hors requête Next, `after` lève : les tâches de fond de la route sont gardées pour être attendues par le test.
const taches: Promise<unknown>[] = [];
vi.mock('next/server', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  after: (tache: () => Promise<unknown>) => {
    taches.push(tache());
  },
}));

avecBaseDeTest();

/** Un appel téléphone hors campagne (sans campagne, la route ne programme rien en tâche de fond). */
async function appelTelephone(valeurs: Partial<typeof appels.$inferInsert> = {}) {
  const e = await entrepriseDeTest();
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const [appel] = await db
    .insert(appels)
    .values({ entrepriseId: e.id, prospectId: 'fictif', versionScriptId, ligne: 'bluetooth', numero: '+33639980001', ...valeurs })
    .returning();
  if (!appel) throw new Error('appel de test non créé');
  return appel;
}

function fin(id: string, corps: unknown) {
  const requete = new Request(`http://127.0.0.1/api/pont/appels/${id}/fin`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret-de-test', 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  return POST(requete, { params: Promise.resolve({ id }) });
}

describe('fin d’un appel téléphone', () => {
  it('sans conversation : terminé, issue et issue système « non-abouti », retrouvé par le filtre', async () => {
    const appel = await appelTelephone();
    const reponse = await fin(appel.id, { raison: 'pas de réponse', conversationId: null });
    expect(reponse.status).toBe(200);

    const [lu] = await db.select().from(appels).where(eq(appels.id, appel.id));
    expect(lu).toMatchObject({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti', bilan: null });
    expect(lu?.finLe).toBeInstanceOf(Date);
    expect((await listerAppels({ issue: 'non-abouti' }, 10)).map((l) => l.appel.id)).toEqual([appel.id]);
  });

  it('téléphone qui n’a pas composé : échec avec sa raison, sans issue', async () => {
    const appel = await appelTelephone();
    await fin(appel.id, { raison: 'composition impossible', conversationId: null });
    const [lu] = await db.select().from(appels).where(eq(appels.id, appel.id));
    expect(lu).toMatchObject({ statut: 'echec', issue: null, issueSysteme: null });
    expect(lu?.erreur).toMatch(/n’a pas composé/);
  });

  it('refuse une requête sans le secret du pont', async () => {
    const appel = await appelTelephone();
    const reponse = await POST(new Request('http://127.0.0.1/', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: appel.id }) });
    expect(reponse.status).toBe(401);
    const [lu] = await db.select().from(appels).where(eq(appels.id, appel.id));
    expect(lu?.statut).toBe('en-cours');
  });
});

describe('fin d’un appel de campagne', () => {
  it('sans conversation : nouvelle tentative prévue pour ce prospect, le suivant est composé après la pause', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    await agendaFrais();
    const pont = await fauxPont({ reglages: { pauseEntreAppelsS: 0 } });
    try {
      const id = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc'] });
      await demarrerCampagne(id);
      await appelerSuivantTelephone(id);
      const [premier] = await db.select({ id: appels.id }).from(appels);
      if (!premier) throw new Error('appel non composé');

      await fin(premier.id, { raison: 'pas de réponse', conversationId: null });
      await Promise.all(taches.splice(0));

      const [c] = await db.select().from(campagnes).where(eq(campagnes.id, id));
      expect(c?.statut).toBe('en-cours');
      expect(c?.entrees).toEqual([
        { prospectId: 'julie', etat: 'a-appeler', tentative: 2, appelsPrecedents: [premier.id], pasAvant: expect.any(String) },
        { prospectId: 'marc', etat: 'en-appel', appelId: expect.any(String) },
      ]);
      expect(pont.compositions().map((r) => (r.corps as { numero: string }).numero)).toEqual(['+33639980001', '+33639980002']);
    } finally {
      await pont.fermer();
    }
  });
});

describe('fin d’un appel entrant', () => {
  it('aucune entrée de file close ; la campagne téléphone retenue par la ligne occupée repart après la pause', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    await agendaFrais();
    const pont = await fauxPont({ reglages: { pauseEntreAppelsS: 0 } });
    try {
      // Marc rappelait pendant le lancement : la campagne est en cours, rien n'est parti.
      const id = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
      await demarrerCampagne(id);
      const [rappel] = await db
        .insert(appels)
        .values({ entrepriseId: e.id, prospectId: 'marc', versionScriptId, ligne: 'bluetooth', sens: 'entrant', numero: '+33639980002' })
        .returning();
      if (!rappel) throw new Error('appel entrant non créé');

      await fin(rappel.id, { raison: 'décroché impossible', conversationId: null, sens: 'entrant' });
      await Promise.all(taches.splice(0));

      const [lu] = await db.select().from(appels).where(eq(appels.id, rappel.id));
      expect(lu).toMatchObject({ statut: 'termine', issueSysteme: 'non-abouti', campagneId: null, sens: 'entrant' });
      const [c] = await db.select().from(campagnes).where(eq(campagnes.id, id));
      expect(c?.entrees).toEqual([{ prospectId: 'julie', etat: 'en-appel', appelId: expect.any(String) }]);
      expect(pont.compositions().map((r) => (r.corps as { numero: string }).numero)).toEqual(['+33639980001']);
    } finally {
      await pont.fermer();
    }
  });
});

describe('migration 0009 : rattrapage des appels non aboutis', () => {
  const migration = readFileSync(new URL('../../../../../../../drizzle/0009_issue-systeme-non-abouti.sql', import.meta.url), 'utf8');

  it('ne pose l’issue système que sur les appels clos par la route sans conversation', async () => {
    const cible = await appelTelephone({ statut: 'termine', issue: 'non-abouti', finLe: new Date() });
    const [avecConversation] = await db
      .insert(appels)
      .values({ ...sansId(cible), conversationId: 'conv-fictive', statut: 'termine', issue: 'non-abouti' })
      .returning();
    const [autreIssue] = await db.insert(appels).values({ ...sansId(cible), statut: 'termine', issue: 'perso:inconnue' }).returning();
    const [enEchec] = await db.insert(appels).values({ ...sansId(cible), statut: 'echec', issue: null }).returning();

    await db.execute(sql.raw(migration));

    const lus = new Map((await db.select().from(appels)).map((a) => [a.id, a.issueSysteme]));
    expect(lus.get(cible.id)).toBe('non-abouti');
    expect(lus.get(avecConversation!.id)).toBeNull();
    expect(lus.get(autreIssue!.id)).toBeNull();
    expect(lus.get(enEchec!.id)).toBeNull();
  });
});

function sansId(a: typeof appels.$inferSelect) {
  return { entrepriseId: a.entrepriseId, prospectId: a.prospectId, versionScriptId: a.versionScriptId, ligne: a.ligne, numero: a.numero };
}
