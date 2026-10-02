import { type EntreeCampagne, prochaineTentative } from '@autocalled/domain';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { fauxPont } from '../../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { analyserAppel } from './appels';
import { appelerSuivantTelephone, clore, demarrerCampagne, derouleSimulation, enregistrerCampagne, sauterProspect, terminerCampagne } from './campagnes';
import { claudeStructure } from './claude';
import { creerScript } from './entreprises';
import { archiverProspect, filesTelephoneEnCours, importerFiches } from './prospects';
import { dansLesHeuresDAppel, planReveil, reveiller } from './reveil';

// À la place du refus de test/garde-fous.ts : une analyse factice, sans claude -p.
vi.mock('@/lib/claude', () => ({ claudeStructure: vi.fn() }));

avecBaseDeTest();

const bilan = (issue: string) => ({ etapeAtteinte: 1, objections: [], resume: 'Résumé fictif.', pointsForts: [], pointsFaibles: [], issue, rappel: null, rappelLe: null });

let pont: Awaited<ReturnType<typeof fauxPont>>;
let entrepriseId: string;
let versionScriptId: string;

beforeEach(async () => {
  vi.mocked(claudeStructure).mockReset();
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
  // Sans pause entre deux appels : un réveil juste après une fin relance aussitôt (la pause a son propre test).
  pont = await fauxPont({ reglages: { pauseEntreAppelsS: 0 } });
});

afterEach(async () => {
  await pont.fermer();
});

async function lire(id: string) {
  const [c] = await db.select().from(campagnes).where(eq(campagnes.id, id));
  if (!c) throw new Error('campagne introuvable');
  return c;
}

const entree = async (id: string, prospectId: string) => (await lire(id)).entrees.find((e) => e.prospectId === prospectId);

async function campagneTelephone(prospects = ['julie', 'marc']) {
  const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects });
  await demarrerCampagne(id);
  await appelerSuivantTelephone(id);
  return id;
}

async function appelEnLigne(campagneId: string): Promise<string> {
  const e = (await lire(campagneId)).entrees.find((x) => x.etat === 'en-appel');
  if (e?.etat !== 'en-appel') throw new Error('aucun appel en ligne');
  return e.appelId;
}

/** Ce que fait la route de fin d'un appel sans décroché : non-abouti posé, entrée close, enchaînement. */
async function finSansReponse(campagneId: string): Promise<{ appelId: string; finLe: Date }> {
  const appelId = await appelEnLigne(campagneId);
  const finLe = new Date();
  await db.update(appels).set({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti', finLe }).where(eq(appels.id, appelId));
  await clore(campagneId, appelId);
  await appelerSuivantTelephone(campagneId);
  return { appelId, finLe };
}

/** Ce que fait la route de fin d'un appel avec conversation : l'entrée attend son bilan, la file continue. */
async function finAvecConversation(campagneId: string): Promise<{ appelId: string; finLe: Date }> {
  const appelId = await appelEnLigne(campagneId);
  const finLe = new Date();
  await db
    .update(appels)
    .set({
      conversationId: `conv-fictive-${appelId}`,
      finLe,
      statut: 'traitement',
      transcription: [{ role: 'agent', texte: 'Bonjour, vous êtes bien sur la messagerie fictive.', secondes: 1 }],
    })
    .where(eq(appels.id, appelId));
  await clore(campagneId, appelId);
  await appelerSuivantTelephone(campagneId);
  return { appelId, finLe };
}

/** Avance l'heure d'une nouvelle tentative prévue : elle est due maintenant. */
async function rendreDue(campagneId: string, prospectId: string) {
  const c = await lire(campagneId);
  const entrees = c.entrees.map((e): EntreeCampagne => (e.prospectId === prospectId && e.etat === 'a-appeler' ? { ...e, pasAvant: new Date(Date.now() - 60_000).toISOString() } : e));
  await db.update(campagnes).set({ entrees }).where(eq(campagnes.id, campagneId));
}

describe('nouvelle tentative sans réponse (ligne téléphone)', () => {
  it('le lendemain au moment opposé, à sa place dans la file ; le suivant est appelé tout de suite', async () => {
    const id = await campagneTelephone();

    const { appelId, finLe } = await finSansReponse(id);

    expect((await lire(id)).entrees).toEqual([
      { prospectId: 'julie', etat: 'a-appeler', tentative: 2, appelsPrecedents: [appelId], pasAvant: prochaineTentative(finLe) },
      { prospectId: 'marc', etat: 'en-appel', appelId: expect.any(String) },
    ]);
    expect(pont.compositions().map((r) => (r.corps as { numero: string }).numero)).toEqual(['+33639980001', '+33639980002']);
  });

  it('dernière entrée : la campagne reste en cours, rien ne part avant l’heure, le réveil la rappelle, trois tentatives au plus', async () => {
    const id = await campagneTelephone(['julie']);

    const premier = await finSansReponse(id);
    expect((await lire(id)).statut).toBe('en-cours');
    await appelerSuivantTelephone(id);
    expect(pont.compositions()).toHaveLength(1);
    expect((await planReveil(new Date())).aRelancer).toEqual([]);

    await rendreDue(id, 'julie');
    expect(await reveiller()).toEqual({ classes: 0, relancees: [id], orphelins: 0 });
    expect(pont.compositions()).toHaveLength(2);
    expect(await entree(id, 'julie')).toMatchObject({ etat: 'en-appel', tentative: 2, appelsPrecedents: [premier.appelId] });

    const second = await finSansReponse(id);
    expect(await entree(id, 'julie')).toMatchObject({ etat: 'a-appeler', tentative: 3, appelsPrecedents: [premier.appelId, second.appelId] });
    await rendreDue(id, 'julie');
    await reveiller();
    const troisieme = await finSansReponse(id);

    const c = await lire(id);
    expect(c.statut).toBe('terminee');
    expect(c.entrees).toEqual([
      { prospectId: 'julie', etat: 'appelee', appelId: troisieme.appelId, tentative: 3, appelsPrecedents: [premier.appelId, second.appelId] },
    ]);
    expect(pont.compositions()).toHaveLength(3);
  });
});

describe('nouvelle tentative décidée par le bilan (répondeur, filtre d’appel)', () => {
  it('l’appel en analyse ne bloque pas la file mais empêche la fin ; le bilan non abouti le remet en file, une réanalyse n’y touche plus', async () => {
    const id = await campagneTelephone();

    const { appelId, finLe } = await finAvecConversation(id);
    expect(await entree(id, 'julie')).toEqual({ prospectId: 'julie', etat: 'en-analyse', appelId });
    // Marc est appelé sans attendre le bilan de Julie ; son appel fini, la campagne attend encore ce bilan.
    const marc = await appelEnLigne(id);
    await db.update(appels).set({ statut: 'termine', issue: 'refus', issueSysteme: 'refus', finLe: new Date() }).where(eq(appels.id, marc));
    await clore(id, marc);
    expect((await lire(id)).statut).toBe('en-cours');

    vi.mocked(claudeStructure).mockResolvedValue(bilan('non-abouti'));
    await analyserAppel(appelId);
    expect(await entree(id, 'julie')).toEqual({
      prospectId: 'julie',
      etat: 'a-appeler',
      tentative: 2,
      appelsPrecedents: [appelId],
      pasAvant: prochaineTentative(finLe),
    });
    expect((await lire(id)).statut).toBe('en-cours');

    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));
    await analyserAppel(appelId);
    expect(await entree(id, 'julie')).toMatchObject({ etat: 'a-appeler', tentative: 2 });
    expect(pont.compositions()).toHaveLength(2);
  });

  it('un bilan qui finit avant la clôture : la clôture classe elle-même', async () => {
    const id = await campagneTelephone();
    const appelId = await appelEnLigne(id);
    await db
      .update(appels)
      .set({ conversationId: 'conv-fictive-avance', finLe: new Date(), transcription: [{ role: 'agent', texte: 'Allô ?', secondes: 1 }] })
      .where(eq(appels.id, appelId));
    vi.mocked(claudeStructure).mockResolvedValue(bilan('non-abouti'));

    await analyserAppel(appelId);
    expect(await entree(id, 'julie')).toMatchObject({ etat: 'en-appel' });
    await clore(id, appelId);

    expect(await entree(id, 'julie')).toMatchObject({ etat: 'a-appeler', tentative: 2, appelsPrecedents: [appelId] });
  });

  it('une analyse en échec : l’entrée est appelée, sans nouvelle tentative', async () => {
    const id = await campagneTelephone(['julie']);
    const { appelId } = await finAvecConversation(id);
    vi.mocked(claudeStructure).mockRejectedValue(new Error('analyse fictive en échec'));

    await analyserAppel(appelId);

    expect((await lire(id)).entrees).toEqual([{ prospectId: 'julie', etat: 'appelee', appelId }]);
    expect((await lire(id)).statut).toBe('terminee');
  });

  it('terminer pendant le bilan du dernier appel : la campagne se termine, le bilan ne relance rien', async () => {
    const id = await campagneTelephone(['julie']);
    const { appelId } = await finAvecConversation(id);

    expect(await terminerCampagne(id)).toEqual({ ok: true, fin: 'immediate' });
    vi.mocked(claudeStructure).mockResolvedValue(bilan('non-abouti'));
    await analyserAppel(appelId);

    expect((await lire(id)).entrees).toEqual([{ prospectId: 'julie', etat: 'appelee', appelId }]);
    expect((await lire(id)).statut).toBe('terminee');
  });

  it('terminer pendant un appel en ligne, quand plus personne n’attend : accepté, ni le bilan ni l’appel ne créent de tentative', async () => {
    const id = await campagneTelephone();
    const julie = await finAvecConversation(id);

    expect(await terminerCampagne(id)).toEqual({ ok: true, fin: 'apres-appel' });
    expect((await lire(id)).entrees.map((e) => e.etat)).toEqual(['appelee', 'en-appel']);
    const marc = await finSansReponse(id);
    vi.mocked(claudeStructure).mockResolvedValue(bilan('non-abouti'));
    await analyserAppel(julie.appelId);

    const c = await lire(id);
    expect(c.entrees).toEqual([
      { prospectId: 'julie', etat: 'appelee', appelId: julie.appelId },
      { prospectId: 'marc', etat: 'appelee', appelId: marc.appelId },
    ]);
    expect(c.statut).toBe('terminee');
    expect(pont.compositions()).toHaveLength(2);
  });
});

describe('ligne téléphone occupée', () => {
  it.each([
    ['un appel en ligne', { appelEnCours: true }],
    ['un prospect qui rappelle', { entrantEnCours: true }],
  ])('%s : rien ne part, aucun prospect n’est consommé, la campagne reste en cours', async (_, etat) => {
    await pont.fermer();
    pont = await fauxPont({ etat });

    const id = await campagneTelephone(['julie']);

    expect(pont.compositions()).toHaveLength(0);
    expect(await db.$count(appels)).toBe(0);
    expect(await lire(id)).toMatchObject({ statut: 'en-cours', entrees: [{ prospectId: 'julie', etat: 'a-appeler' }] });
  });

  it('prise entre la lecture de la ligne et la composition (409) : l’appel s’efface, le prospect garde sa place, pas de pause', async () => {
    await pont.fermer();
    pont = await fauxPont({ refusAppels: { statut: 409, erreur: 'Un appel entrant est en cours sur le téléphone.' } });

    const id = await campagneTelephone(['julie']);

    expect(pont.compositions()).toHaveLength(1);
    expect(await db.$count(appels)).toBe(0);
    expect(await lire(id)).toMatchObject({ statut: 'en-cours', entrees: [{ prospectId: 'julie', etat: 'a-appeler' }] });
  });

  it('une nouvelle tentative refusée en 409 garde son numéro et ses appels passés', async () => {
    const id = await campagneTelephone(['julie']);
    const premier = await finSansReponse(id);
    await rendreDue(id, 'julie');
    await pont.fermer();
    pont = await fauxPont({ refusAppels: { statut: 409, erreur: 'Un appel entrant est en cours sur le téléphone.' } });

    await appelerSuivantTelephone(id);

    expect(await entree(id, 'julie')).toMatchObject({ etat: 'a-appeler', tentative: 2, appelsPrecedents: [premier.appelId] });
    expect(await db.$count(appels)).toBe(1);
    expect((await lire(id)).statut).toBe('en-cours');
  });

  it('pont injoignable (503) : l’appel échoue et la campagne se met en pause, comme avant', async () => {
    await pont.fermer();
    pont = await fauxPont({ refusAppels: { statut: 503, erreur: 'Composition impossible : téléphone absent.' } });

    const id = await campagneTelephone();

    expect(await lire(id)).toMatchObject({ statut: 'en-pause', entrees: [{ etat: 'appelee' }, { etat: 'a-appeler' }] });
    expect(await db.select({ statut: appels.statut }).from(appels)).toEqual([{ statut: 'echec' }]);
  });

  it('plafond atteint : la campagne se met en pause, comme avant', async () => {
    await pont.fermer();
    pont = await fauxPont({ plafond: 'Plafond fictif atteint.' });

    const id = await campagneTelephone(['julie']);

    expect(pont.compositions()).toHaveLength(0);
    expect((await lire(id)).statut).toBe('en-pause');
  });
});

describe('pause entre deux appels', () => {
  it('un bilan ou le réveil pendant la pause ne compose rien ; après la pause, le réveil reprend', async () => {
    await pont.fermer();
    pont = await fauxPont({ reglages: { pauseEntreAppelsS: 120 } });
    const id = await campagneTelephone();
    const julie = await appelEnLigne(id);
    await db
      .update(appels)
      .set({ conversationId: 'conv-fictive-pause', finLe: new Date(), statut: 'traitement', transcription: [{ role: 'agent', texte: 'Bonjour.', secondes: 1 }] })
      .where(eq(appels.id, julie));
    await clore(id, julie);

    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));
    await analyserAppel(julie);
    expect(await reveiller()).toEqual({ classes: 0, relancees: [], orphelins: 0 });
    expect(pont.compositions()).toHaveLength(1);

    await db.update(appels).set({ finLe: new Date(Date.now() - 3 * 60_000) }).where(eq(appels.id, julie));
    expect(await reveiller()).toEqual({ classes: 0, relancees: [id], orphelins: 0 });
    expect(pont.compositions()).toHaveLength(2);
  });
});

describe('gestes et nouvelles tentatives', () => {
  it('sauter est refusé quand seules des tentatives à venir suivent : le prospect resterait le prochain appelé', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc'] });
    const entrees: EntreeCampagne[] = [
      { prospectId: 'julie', etat: 'a-appeler' },
      { prospectId: 'marc', etat: 'a-appeler', tentative: 2, appelsPrecedents: ['00000000-0000-4000-8000-000000000001'], pasAvant: new Date(Date.now() + 3_600_000).toISOString() },
    ];
    await db.update(campagnes).set({ entrees }).where(eq(campagnes.id, id));

    expect(await sauterProspect(id, 'julie')).toEqual({ ok: false, raison: expect.stringContaining('dernier prospect à appeler maintenant') });
    expect((await lire(id)).entrees).toEqual(entrees);
  });

  it('archiver un prospect dont le bilan est en cours : sans confirmation, et ce bilan ne le remet pas en file', async () => {
    const id = await campagneTelephone();
    const julie = await finAvecConversation(id);
    expect((await filesTelephoneEnCours(entrepriseId, ['julie'])).get('julie')).toEqual([id]);

    expect(await archiverProspect(entrepriseId, 'julie', 'interface', [])).toEqual({ ok: true, deja: false, retireDe: [], terminees: [] });
    vi.mocked(claudeStructure).mockResolvedValue(bilan('non-abouti'));
    await analyserAppel(julie.appelId);

    expect(await entree(id, 'julie')).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: julie.appelId });
  });

  it('un prospect qui vient de rappeler et dont l’appel est en analyse n’est pas recomposé ; son bilan retire la tentative', async () => {
    const id = await campagneTelephone(['julie']);
    await finSansReponse(id);
    await rendreDue(id, 'julie');
    const [rappel] = await db
      .insert(appels)
      .values({
        entrepriseId,
        prospectId: 'julie',
        versionScriptId,
        ligne: 'bluetooth',
        sens: 'entrant',
        numero: '+33639980001',
        statut: 'traitement',
        conversationId: 'conv-fictive-rappel',
        finLe: new Date(Date.now() - 60_000),
        transcription: [{ role: 'agent', texte: 'Allô, oui bonjour.', secondes: 0 }],
      })
      .returning({ id: appels.id });

    await reveiller();
    expect(pont.compositions()).toHaveLength(1);
    expect(await entree(id, 'julie')).toMatchObject({ etat: 'a-appeler', tentative: 2 });

    vi.mocked(claudeStructure).mockResolvedValue(bilan('refus'));
    await analyserAppel(rappel?.id ?? '');
    expect(await lire(id)).toMatchObject({ statut: 'terminee', entrees: [{ prospectId: 'julie', etat: 'retiree', motif: 'rappel-entrant' }] });
    expect(pont.compositions()).toHaveLength(1);
  });
});

describe('campagne simulée', () => {
  it('s’arrête quand plus rien n’est dû : la nouvelle tentative reste en file, la campagne en cours', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });
    await demarrerCampagne(id);
    const plusTard = new Date(Date.now() + 3_600_000).toISOString();
    const entrees: EntreeCampagne[] = [
      { prospectId: 'julie', etat: 'a-appeler', tentative: 2, appelsPrecedents: ['00000000-0000-4000-8000-000000000001'], pasAvant: plusTard },
      { prospectId: 'marc', etat: 'a-appeler' },
    ];
    await db.update(campagnes).set({ entrees }).where(eq(campagnes.id, id));

    // ElevenLabs est interdit en test : l'appel simulé de Marc échoue, la file avance comme en vrai.
    await derouleSimulation(id);

    const c = await lire(id);
    expect(c.statut).toBe('en-cours');
    expect(c.entrees.map((e) => [e.prospectId, e.etat])).toEqual([
      ['julie', 'a-appeler'],
      ['marc', 'appelee'],
    ]);
    // Le réveil ne relance que la ligne téléphone.
    expect((await planReveil(new Date(Date.now() + 2 * 3_600_000))).aRelancer).toEqual([]);
  });
});

describe('réveil', () => {
  async function campagneEnBase(statut: 'en-cours' | 'en-pause', ligne: 'bluetooth' | 'navigateur' = 'bluetooth') {
    const [appel] = await db
      .insert(appels)
      .values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne, numero: '+33639980001', statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti', finLe: new Date() })
      .returning({ id: appels.id });
    if (!appel) throw new Error('appel non créé');
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne, prospects: ['julie', 'marc'] });
    await db.update(appels).set({ campagneId: id }).where(eq(appels.id, appel.id));
    const entrees: EntreeCampagne[] = [
      { prospectId: 'julie', etat: 'en-analyse', appelId: appel.id },
      { prospectId: 'marc', etat: 'a-appeler' },
    ];
    await db.update(campagnes).set({ statut, entrees }).where(eq(campagnes.id, id));
    return { id, appelId: appel.id };
  }

  it('rattrape un classement perdu puis relance la campagne due ; l’essai dit la même chose sans rien écrire', async () => {
    const { id, appelId } = await campagneEnBase('en-cours');
    const avant = await lire(id);

    // Comme `pnpm reveil --essai` : une transaction en lecture seule.
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return planReveil(new Date(), tx);
    });
    expect(plan).toEqual({ aClasser: [{ campagneId: id, appelId }], aRelancer: [id], orphelins: [] });
    expect(await lire(id)).toEqual(avant);
    expect(pont.compositions()).toHaveLength(0);

    expect(await reveiller()).toEqual({ classes: 1, relancees: [id], orphelins: 0 });
    expect((await lire(id)).entrees).toEqual([
      { prospectId: 'julie', etat: 'a-appeler', tentative: 2, appelsPrecedents: [appelId], pasAvant: expect.any(String) },
      { prospectId: 'marc', etat: 'en-appel', appelId: expect.any(String) },
    ]);
    expect(pont.compositions()).toHaveLength(1);
  });

  it('ne relance jamais une campagne en pause, ni une autre ligne que le téléphone, mais classe leurs appels', async () => {
    const enPause = await campagneEnBase('en-pause');
    const navigateur = await campagneEnBase('en-cours', 'navigateur');

    expect(await reveiller()).toEqual({ classes: 2, relancees: [], orphelins: 0 });

    expect(pont.compositions()).toHaveLength(0);
    expect((await lire(enPause.id)).statut).toBe('en-pause');
    expect(await entree(navigateur.id, 'julie')).toMatchObject({ etat: 'a-appeler', tentative: 2 });
  });

  it('passe en échec un appel entrant que le pont n’a jamais pris (sans conversation depuis plus de 10 minutes)', async () => {
    const entrant = (debutLe: Date) => ({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth' as const, sens: 'entrant' as const, numero: '+33639980001', debutLe });
    const [vieux] = await db.insert(appels).values(entrant(new Date(Date.now() - 20 * 60_000))).returning({ id: appels.id });
    const [recent] = await db.insert(appels).values(entrant(new Date(Date.now() - 60_000))).returning({ id: appels.id });

    expect((await planReveil(new Date())).orphelins).toEqual([vieux?.id]);
    expect(await reveiller()).toEqual({ classes: 0, relancees: [], orphelins: 1 });

    const lus = await db.select({ id: appels.id, statut: appels.statut, erreur: appels.erreur }).from(appels);
    expect(lus.find((a) => a.id === vieux?.id)).toMatchObject({ statut: 'echec', erreur: expect.stringContaining('jamais pris') });
    expect(lus.find((a) => a.id === recent?.id)).toMatchObject({ statut: 'en-cours', erreur: null });
  });

  it('laisse une entrée dont le bilan n’est pas encore écrit', async () => {
    const { id, appelId } = await campagneEnBase('en-pause');
    await db.update(appels).set({ statut: 'traitement', issue: null, issueSysteme: null }).where(eq(appels.id, appelId));

    expect(await reveiller()).toEqual({ classes: 0, relancees: [], orphelins: 0 });
    expect(await entree(id, 'julie')).toEqual({ prospectId: 'julie', etat: 'en-analyse', appelId });
  });
});

describe('Heures d’appel du réveil', () => {
  it('relance de 9 h à 19 h, heure de Paris, été comme hiver', () => {
    expect(dansLesHeuresDAppel(new Date('2026-10-02T06:59:00Z'))).toBe(false); // 8 h 59 à Paris (heure d'été)
    expect(dansLesHeuresDAppel(new Date('2026-10-02T07:00:00Z'))).toBe(true); // 9 h
    expect(dansLesHeuresDAppel(new Date('2026-10-02T16:59:00Z'))).toBe(true); // 18 h 59
    expect(dansLesHeuresDAppel(new Date('2026-10-02T17:00:00Z'))).toBe(false); // 19 h
    expect(dansLesHeuresDAppel(new Date('2026-12-15T08:00:00Z'))).toBe(true); // 9 h (heure d'hiver)
    expect(dansLesHeuresDAppel(new Date('2026-12-15T01:00:00Z'))).toBe(false); // 2 h
  });

  it('hors des heures, classe sans relancer', async () => {
    expect(await reveiller(new Date(), { relancer: false })).toEqual({ classes: 0, relancees: [], orphelins: 0 });
  });
});
