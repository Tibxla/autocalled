import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { fauxPont } from '../../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { analyserAppel, appelerParTelephone, DUREE_MAX_ANALYSE_S, enregistrerAppelSimule, preparerReanalyse, traiterAppel } from './appels';
import { modifierAssistante } from './assistante';
import { creerScript } from './entreprises';
import { importerFiches } from './prospects';

avecBaseDeTest();

async function appel(valeurs: Partial<typeof appels.$inferInsert> = {}) {
  const e = await entrepriseDeTest();
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const [cree] = await db
    .insert(appels)
    .values({ entrepriseId: e.id, prospectId: 'fictif', versionScriptId, ligne: 'bluetooth', numero: '+33639980002', ...valeurs })
    .returning();
  if (!cree) throw new Error('appel de test non créé');
  return cree;
}

const lire = async (id: string) => (await db.select().from(appels).where(eq(appels.id, id)))[0];

describe('traiterAppel', () => {
  it('sans conversation : échec avec une raison, au lieu de rester en traitement', async () => {
    const a = await appel({ statut: 'traitement' });
    await traiterAppel(a.id);
    const lu = await lire(a.id);
    expect(lu?.statut).toBe('echec');
    expect(lu?.erreur).toMatch(/Aucune conversation/);
    expect(lu?.finLe).toBeInstanceOf(Date);
  });
});

describe('analyserAppel', () => {
  it('sans transcription mais avec conversation : échec qui dit de rapatrier', async () => {
    const a = await appel({ statut: 'traitement', conversationId: 'conv-fictive-1' });
    await analyserAppel(a.id);
    const lu = await lire(a.id);
    expect(lu?.statut).toBe('echec');
    expect(lu?.erreur).toMatch(/transcription n’a pas été rapatriée/);
  });

  it('sans transcription ni conversation : échec explicite', async () => {
    const a = await appel({ statut: 'traitement' });
    await analyserAppel(a.id);
    expect((await lire(a.id))?.erreur).toMatch(/Aucune transcription ni conversation/);
  });
});

describe('preparerReanalyse', () => {
  it('passe un appel en échec en traitement avant tout travail, erreur effacée', async () => {
    const a = await appel({ statut: 'echec', conversationId: 'conv-fictive-2', erreur: 'ancienne erreur', finLe: new Date('2026-01-01T10:00:00Z') });
    const maintenant = new Date('2026-09-29T12:00:00Z');
    expect(await preparerReanalyse(a.id, maintenant)).toEqual({ ok: true });
    expect(await lire(a.id)).toMatchObject({ statut: 'traitement', erreur: null, traitementLe: maintenant });
  });

  it('refuse un non abouti sans conversation, sans le toucher', async () => {
    const a = await appel({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti' });
    const r = await preparerReanalyse(a.id);
    expect(r.ok).toBe(false);
    expect(await lire(a.id)).toMatchObject({ statut: 'termine', issueSysteme: 'non-abouti' });
  });

  it('refuse une analyse en cours, accepte une analyse bloquée', async () => {
    const debut = new Date('2026-09-29T12:00:00Z');
    const a = await appel({ statut: 'traitement', conversationId: 'conv-fictive-3', traitementLe: debut });
    expect(await preparerReanalyse(a.id, new Date(debut.getTime() + 60_000))).toEqual({
      ok: false,
      raison: 'Le bilan de cet appel est déjà en cours de calcul.',
    });
    expect(await preparerReanalyse(a.id, new Date(debut.getTime() + (DUREE_MAX_ANALYSE_S + 1) * 1000))).toEqual({ ok: true });
  });

  it('refuse un appel téléphone encore en cours et un appel inconnu', async () => {
    const a = await appel({ conversationId: 'conv-fictive-4' });
    expect((await preparerReanalyse(a.id)).ok).toBe(false);
    expect(await preparerReanalyse('00000000-0000-0000-0000-000000000000')).toEqual({ ok: false, raison: 'Cet appel n’existe plus.' });
  });
});

describe('nom et premier message de l’assistante', () => {
  async function prospectAutorise() {
    await agendaFrais();
    const e = await entrepriseDeTest();
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    return { entrepriseId: e.id, versionScriptId };
  }

  it('fige le nom sur l’appel téléphone et envoie au pont le premier message composé', async () => {
    const pont = await fauxPont();
    try {
      await modifierAssistante({ nom: 'Lina', premierMessage: 'Allô, {{prospect_nom}} ?' }, { origine: 'mcp' });
      const { entrepriseId, versionScriptId } = await prospectAutorise();

      const r = await appelerParTelephone(entrepriseId, 'julie', versionScriptId);

      expect(r.ok).toBe(true);
      expect(pont.compositions()[0]?.corps).toMatchObject({
        premierMessage: 'Allô, Julie Fictive ?',
        variables: { assistante_nom: 'Lina' },
      });
      expect((await lire((r as { appelId: string }).appelId))?.assistanteNom).toBe('Lina');
    } finally {
      await pont.fermer();
    }
  });

  it('fige le nom par défaut sur un appel simulé', async () => {
    const { entrepriseId, versionScriptId } = await prospectAutorise();

    const r = await enregistrerAppelSimule(entrepriseId, 'julie', versionScriptId);

    expect(r.ok && r.variables.assistante_nom).toBe('Mina');
    expect((await lire((r as { appelId: string }).appelId))?.assistanteNom).toBe('Mina');
  });
});
