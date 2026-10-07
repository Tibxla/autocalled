import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { campagnes } from '@/db/schema';
import { demarrerCampagne, enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
import { entrepriseDeTest, fiche } from '../../../test/fixtures';
import { avecBaseDeTest } from '../../../test/outils';

const etat = vi.hoisted(() => ({ operateur: true, revalidations: [] as string[] }));
vi.mock('@/lib/garde', () => ({ exigerOperateur: async () => {
  if (!etat.operateur) throw new Error('accès réservé à l’opérateur');
} }));
vi.mock('next/cache', () => ({ revalidatePath: (chemin: string) => void etat.revalidations.push(chemin) }));

const { supprimerCampagne } = await import('./actions');
avecBaseDeTest();
beforeEach(() => { etat.operateur = true; etat.revalidations = []; });

async function prete() {
  const e = await entrepriseDeTest();
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
  const { versionScriptId } = await creerScript(e.id, 'Découverte fictive');
  return enregistrerCampagne(e.id, { versionScriptId, ligne: 'navigateur', prospects: ['julie'] });
}

describe('supprimer une campagne depuis l’interface', () => {
  it('exige une confirmation avant de supprimer une campagne jamais lancée', async () => {
    const id = await prete();
    expect(await supprimerCampagne(id, false)).toMatchObject({ ok: false });
    expect((await db.select().from(campagnes))).toHaveLength(1);
    expect(await supprimerCampagne(id, true)).toEqual({ ok: true });
    expect((await db.select().from(campagnes))).toHaveLength(0);
    expect(etat.revalidations).toContain('/entreprises');
  });

  it('préserve une campagne lancée depuis l’ouverture de la confirmation', async () => {
    const id = await prete();
    await demarrerCampagne(id);
    expect(await supprimerCampagne(id, true)).toMatchObject({ ok: false, raison: expect.stringContaining('jamais lancée') });
    expect(await supprimerCampagne('invalide', true)).toMatchObject({ ok: false });
    expect((await db.select().from(campagnes))).toHaveLength(1);
    expect(etat.revalidations).toEqual([]);
  });

  it('refuse une suppression hors accès opérateur', async () => {
    const id = await prete();
    etat.operateur = false;
    await expect(supprimerCampagne(id, true)).rejects.toThrow('réservé à l’opérateur');
    expect((await db.select().from(campagnes))).toHaveLength(1);
  });
});
