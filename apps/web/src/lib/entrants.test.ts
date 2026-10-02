import { type EntreeCampagne } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { fauxPont } from '../../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { appelsTelephoneRecents } from './accueil';
import { analyserAppel } from './appels';
import { appelerSuivantTelephone, clore, demarrerCampagne, enregistrerCampagne } from './campagnes';
import { claudeStructure } from './claude';
import { creerScript } from './entreprises';
import { situationEntrant } from './entrants';
import { importerFiches } from './prospects';

// À la place du refus de test/garde-fous.ts : une analyse factice, sans claude -p.
vi.mock('@/lib/claude', () => ({ claudeStructure: vi.fn() }));

avecBaseDeTest();

describe('situationEntrant', () => {
  const base = { nom: 'Julie Fictive', fuseau: 'Europe/Paris' };
  // Jeudi 1er octobre 2026, 0 h 30 à Paris (la veille au soir en UTC).
  const maintenant = new Date('2026-09-30T22:30:00Z');

  it('le jour même, dans le fuseau de l’entreprise', () => {
    expect(situationEntrant({ ...base, maintenant, dernierAppel: { le: new Date('2026-09-30T22:10:00Z'), issueSysteme: 'non-abouti' } })).toBe(
      "C'est Julie Fictive qui te rappelle, après ton appel d'aujourd'hui, resté sans réponse. Tu viens de décrocher en te présentant : remercie pour ce rappel, puis reprends ton plan là où il en est. C'est lui qui appelle : ne demande pas de minutes ni la permission de parler, donne directement la raison de ton appel.",
    );
  });

  it('la veille, même à moins de vingt-quatre heures', () => {
    expect(situationEntrant({ ...base, maintenant, dernierAppel: { le: new Date('2026-09-30T12:00:00Z'), issueSysteme: 'interrompu' } })).toMatch(
      /^C'est Julie Fictive qui te rappelle, après ton appel d'hier\. /,
    );
  });

  it('plus loin : la date en toutes lettres, sans le jour de la semaine', () => {
    expect(situationEntrant({ ...base, maintenant, dernierAppel: { le: new Date('2026-09-28T08:00:00Z'), issueSysteme: null } })).toMatch(
      /^C'est Julie Fictive qui te rappelle, après ton appel du 28 septembre\. /,
    );
  });

  it('passe le 1er janvier : la veille est le 31 décembre', () => {
    expect(
      situationEntrant({ ...base, maintenant: new Date('2027-01-01T09:00:00Z'), dernierAppel: { le: new Date('2026-12-31T15:00:00Z'), issueSysteme: 'non-abouti' } }),
    ).toMatch(/après ton appel d'hier, resté sans réponse\./);
  });
});

describe('après un appel entrant', () => {
  let pont: Awaited<ReturnType<typeof fauxPont>>;
  let entrepriseId: string;
  let versionScriptId: string;

  const bilan = (issue: string) => ({ etapeAtteinte: 1, objections: [], resume: 'Résumé fictif.', pointsForts: [], pointsFaibles: [], issue, rappel: null, rappelLe: null });

  beforeEach(async () => {
    vi.mocked(claudeStructure).mockReset();
    const e = await entrepriseDeTest();
    entrepriseId = e.id;
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
    await agendaFrais();
    pont = await fauxPont();
  });

  afterEach(async () => {
    await pont.fermer();
  });

  const lireCampagne = async (id: string) => (await db.select().from(campagnes).where(eq(campagnes.id, id)))[0];

  /** Une campagne téléphone où Julie n'a pas répondu : sa 2ᵉ tentative est prévue, Marc est en ligne. */
  async function tentativePrevue(): Promise<string> {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc'] });
    await demarrerCampagne(id);
    await appelerSuivantTelephone(id);
    const [premier] = await db.select({ id: appels.id }).from(appels);
    if (!premier) throw new Error('appel non composé');
    await db.update(appels).set({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti', finLe: new Date() }).where(eq(appels.id, premier.id));
    await clore(id, premier.id);
    await appelerSuivantTelephone(id);
    expect((await lireCampagne(id))?.entrees[0]).toMatchObject({ prospectId: 'julie', etat: 'a-appeler', tentative: 2 });
    return id;
  }

  /** Julie rappelle, Mina décroche et la conversation a lieu ; le bilan reste à écrire. */
  async function rappelDeJulie(): Promise<string> {
    const [a] = await db
      .insert(appels)
      .values({
        entrepriseId,
        prospectId: 'julie',
        versionScriptId,
        ligne: 'bluetooth',
        sens: 'entrant',
        numero: '+33639980001',
        statut: 'traitement',
        conversationId: 'conv-fictive-entrant',
        finLe: new Date(),
        transcription: [{ role: 'agent', texte: 'Allô, oui bonjour, Mina à l’appareil.', secondes: 0 }],
      })
      .returning({ id: appels.id });
    if (!a) throw new Error('appel entrant non créé');
    return a.id;
  }

  it('avec conversation : la nouvelle tentative prévue est retirée (rappel entrant), le reste de la file intact', async () => {
    const id = await tentativePrevue();
    const entrantId = await rappelDeJulie();
    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));

    await analyserAppel(entrantId);

    const c = await lireCampagne(id);
    expect(c?.entrees[0]).toMatchObject({ prospectId: 'julie', etat: 'retiree', motif: 'rappel-entrant', par: 'systeme', le: expect.any(String) });
    expect(c?.entrees[1]).toMatchObject({ prospectId: 'marc', etat: 'en-appel' });
    expect(c?.statut).toBe('en-cours');
    // L'analyseur sait que le prospect a rappelé.
    const consigne = vi.mocked(claudeStructure).mock.calls[0]?.[0].prompt ?? '';
    expect(consigne).toMatch(/^Tu analyses un appel entrant : le prospect a rappelé/);
    expect(consigne).toContain('ne lui reproche pas l\'ouverture');
  });

  it('bilan « non abouti » ou analyse en échec : la tentative reste prévue', async () => {
    const id = await tentativePrevue();
    const avant = (await lireCampagne(id))?.entrees;
    const entrantId = await rappelDeJulie();

    vi.mocked(claudeStructure).mockResolvedValue(bilan('non-abouti'));
    await analyserAppel(entrantId);
    expect((await lireCampagne(id))?.entrees).toEqual(avant);

    vi.mocked(claudeStructure).mockRejectedValue(new Error('analyse factice en échec'));
    await analyserAppel(entrantId);
    expect((await db.select({ statut: appels.statut }).from(appels).where(eq(appels.id, entrantId)))[0]?.statut).toBe('echec');
    expect((await lireCampagne(id))?.entrees).toEqual(avant);
  });

  it('la réanalyse d’un rappel plus ancien que le dernier appel de la tentative ne la retire pas', async () => {
    const id = await tentativePrevue();
    const avant = (await lireCampagne(id))?.entrees;
    const entrantId = await rappelDeJulie();
    await db.update(appels).set({ debutLe: new Date(Date.now() - 24 * 3_600_000) }).where(eq(appels.id, entrantId));
    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));

    await analyserAppel(entrantId);

    expect((await lireCampagne(id))?.entrees).toEqual(avant);
  });

  it('un prospect jamais appelé dans cette campagne garde sa place', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['marc', 'julie'] });
    await demarrerCampagne(id);
    const entrantId = await rappelDeJulie();
    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));

    await analyserAppel(entrantId);

    expect((await lireCampagne(id))?.entrees).toEqual([
      { prospectId: 'marc', etat: 'a-appeler' },
      { prospectId: 'julie', etat: 'a-appeler' },
    ] satisfies EntreeCampagne[]);
  });

  it('un appel sortant analysé ne retire rien hors de sa propre entrée', async () => {
    const id = await tentativePrevue();
    const [sortant] = await db
      .insert(appels)
      .values({
        entrepriseId,
        prospectId: 'julie',
        versionScriptId,
        ligne: 'bluetooth',
        numero: '+33639980001',
        statut: 'traitement',
        conversationId: 'conv-fictive-sortant',
        finLe: new Date(),
        transcription: [{ role: 'agent', texte: 'Bonjour.', secondes: 0 }],
      })
      .returning({ id: appels.id });
    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));

    await analyserAppel(sortant?.id ?? '');

    expect((await lireCampagne(id))?.entrees[0]).toMatchObject({ prospectId: 'julie', etat: 'a-appeler', tentative: 2 });
    expect(vi.mocked(claudeStructure).mock.calls[0]?.[0].prompt).toMatch(/^Tu analyses un appel de prospection passé par Mina/);
  });

  it('les compteurs du plafond ne comptent que les appels sortants', async () => {
    await rappelDeJulie();
    await db.insert(appels).values({ entrepriseId, prospectId: 'marc', versionScriptId, ligne: 'bluetooth', numero: '+33639980002' });

    expect(await appelsTelephoneRecents()).toEqual({ derniereHeure: 1, dernieres24h: 1 });
  });
});
