import { type EntreeCampagne, prochaineTentative } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { fauxPont } from '../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

/** Nouvelles tentatives (une entrée qui attend son heure, un bilan en cours) et appels entrants, vus par le MCP. */

avecBaseDeTest();

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let client: Client | undefined;
let pont: Awaited<ReturnType<typeof fauxPont>>;
let entrepriseId: string;
let versionScriptId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [
    fiche('julie', 'Julie Fictive', '06 39 98 00 01'),
    fiche('marc', 'Marc Fictif', '06 39 98 00 02'),
    fiche('lea', 'Léa Fictive', '06 39 98 00 03'),
  ]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
  pont = await fauxPont();
});
afterEach(async () => {
  await client?.fermer();
  client = undefined;
  await pont.fermer();
});

async function connecter(options: Parameters<typeof clientDeTest>[0] = {}) {
  client = await clientDeTest(options);
  return client;
}

async function appel(valeurs: Partial<typeof appels.$inferInsert> = {}) {
  const [a] = await db
    .insert(appels)
    .values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001', statut: 'termine', ...valeurs })
    .returning();
  return a!;
}

/** Une campagne téléphone dont on pose la file à la main, comme le domaine l'aurait laissée. */
async function campagneAvec(statut: 'en-cours' | 'en-pause', entrees: (campagneId: string) => Promise<EntreeCampagne[]>) {
  const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc', 'lea'] });
  await db.update(campagnes).set({ statut, entrees: await entrees(campagneId) }).where(eq(campagnes.id, campagneId));
  return campagneId;
}

describe('nouvelles tentatives', () => {
  it('lire_campagne montre la tentative, son heure, les appels passés et le bilan en cours ; le prochain est le prochain dû', async () => {
    const demain = prochaineTentative(new Date());
    let premier = '';
    let analyse = '';
    const campagneId = await campagneAvec('en-cours', async (id) => {
      premier = (await appel({ campagneId: id, issueSysteme: 'non-abouti', issue: 'non-abouti' })).id;
      analyse = (await appel({ campagneId: id, prospectId: 'lea', numero: '+33639980003', statut: 'traitement' })).id;
      return [
        { prospectId: 'julie', etat: 'a-appeler', tentative: 2, pasAvant: demain, appelsPrecedents: [premier] },
        { prospectId: 'marc', etat: 'a-appeler' },
        { prospectId: 'lea', etat: 'en-analyse', appelId: analyse },
      ];
    });
    const { appeler } = await connecter();

    const lue = (await appeler('lire_campagne', { campagneId })).json as Record<string, unknown>;
    expect(lue).toMatchObject({ prochainProspect: 'marc', prochaineTentativeLe: demain, tentativesMax: 3 });
    expect(lue.file).toEqual([
      expect.objectContaining({
        prospect: 'julie',
        etat: 'a-appeler',
        tentative: 2,
        pasAvant: demain,
        due: false,
        appelsPrecedents: [expect.objectContaining({ appelId: premier, statut: 'termine', issue: 'Non abouti' })],
      }),
      expect.objectContaining({ prospect: 'marc', etat: 'a-appeler', tentative: 1, due: true }),
      expect.objectContaining({ prospect: 'lea', etat: 'en-analyse', tentative: 1, appelId: analyse, statut: 'traitement' }),
    ]);
    expect((await appeler('lister_campagnes', { entreprise: 'gite-fictif' })).json).toEqual([
      expect.objectContaining({ campagneId, aAppeler: 2, aRetenter: 1, enAnalyse: 1, traites: 1, total: 3, prochaineTentativeLe: demain }),
    ]);

    // Plus rien de dû : la campagne attend la tentative de demain.
    await db
      .update(campagnes)
      .set({ entrees: [{ prospectId: 'julie', etat: 'a-appeler', tentative: 2, pasAvant: demain, appelsPrecedents: [premier] }] })
      .where(eq(campagnes.id, campagneId));
    expect((await appeler('lire_campagne', { campagneId })).json).toMatchObject({ prochainProspect: null, prochaineTentativeLe: demain });
  });

  it('lancer_campagne distingue les prospects dus des tentatives prévues, qui entrent dans la question', async () => {
    const demain = prochaineTentative(new Date());
    const campagneId = await campagneAvec('en-pause', async (id) => {
      const premier = (await appel({ campagneId: id, issueSysteme: 'non-abouti' })).id;
      return [
        { prospectId: 'julie', etat: 'a-appeler', tentative: 2, pasAvant: demain, appelsPrecedents: [premier] },
        { prospectId: 'marc', etat: 'a-appeler' },
        { prospectId: 'lea', etat: 'appelee', appelId: (await appel({ campagneId: id, prospectId: 'lea', numero: '+33639980003', issueSysteme: 'refus' })).id },
      ];
    });
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_campagne', { campagneId });

    expect(messages[0]).toMatch(
      /^Reprendre la campagne de Gîte fictif sur le téléphone passerelle : 1 prospect à appeler l’un après l’autre, dont 1 au numéro appelable à cet instant \(les autres seront sautés\), avec le script « Découverte · v1 »\. À appeler : Marc Fictif\. Plus tard : 1 nouvelle tentative \(prospect sans réponse\), la première demain à \d\d:00 ; elles partent d’elles-mêmes à leur heure tant que la campagne est en cours, et comptent dans les garde-fous\. Nous sommes /,
    );
    expect(r.json).toMatchObject({ statut: 'en-cours', appelEnCours: { prospect: 'marc' } });
    expect(pont.compositions().map((c) => (c.corps as { numero: string }).numero)).toEqual(['+33639980002']);
  });

  it('lancer_campagne sans prospect dû : rien ne compose, la réponse dit l’heure de la prochaine tentative', async () => {
    const demain = prochaineTentative(new Date());
    const campagneId = await campagneAvec('en-pause', async (id) => {
      const premier = (await appel({ campagneId: id, issueSysteme: 'non-abouti' })).id;
      return [
        { prospectId: 'julie', etat: 'a-appeler', tentative: 2, pasAvant: demain, appelsPrecedents: [premier] },
        { prospectId: 'marc', etat: 'retiree', motif: 'retrait', le: new Date().toISOString(), par: 'mcp' },
        { prospectId: 'lea', etat: 'retiree', motif: 'retrait', le: new Date().toISOString(), par: 'mcp' },
      ];
    });
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_campagne', { campagneId });

    expect(messages[0]).toMatch(/^Reprendre la campagne de Gîte fictif sur le téléphone passerelle : aucun prospect à appeler maintenant, avec le script « Découverte · v1 »\. Plus tard : 1 nouvelle tentative/);
    expect(r.json).toMatchObject({ statut: 'en-cours', appelEnCours: null, attente: { motif: 'prochaine-tentative', le: demain } });
    expect(pont.compositions()).toHaveLength(0);
  });
});

describe('bilan en cours', () => {
  it('lancer_campagne quand seul un bilan est en cours : la réponse le dit, sans annoncer de tentative', async () => {
    const campagneId = await campagneAvec('en-pause', async (id) => {
      const enAnalyse = (await appel({ campagneId: id, statut: 'traitement' })).id;
      return [
        { prospectId: 'julie', etat: 'en-analyse', appelId: enAnalyse },
        { prospectId: 'marc', etat: 'retiree', motif: 'retrait', le: new Date().toISOString(), par: 'mcp' },
        { prospectId: 'lea', etat: 'retiree', motif: 'retrait', le: new Date().toISOString(), par: 'mcp' },
      ];
    });
    const { appeler } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_campagne', { campagneId });

    expect(r.json).toMatchObject({ statut: 'en-cours', appelEnCours: null, attente: { motif: 'bilan-en-cours', le: null } });
    expect(pont.compositions()).toHaveLength(0);
  });
});

describe('appels entrants', () => {
  it('lister_appels filtre par sens et le rend sur chaque appel ; lire_appel, lire_prospect et lire_journee le portent', async () => {
    const sortant = await appel({ issueSysteme: 'non-abouti', debutLe: new Date(Date.now() - 60_000) });
    const entrant = await appel({ sens: 'entrant', issueSysteme: 'rendez-vous-pris' });
    const { appeler } = await connecter();

    const tous = (await appeler('lister_appels', { entreprise: 'gite-fictif' })).json as { appels: { appelId: string; sens: string }[] };
    expect(tous.appels.map((a) => [a.appelId, a.sens])).toEqual([
      [entrant.id, 'entrant'],
      [sortant.id, 'sortant'],
    ]);
    const entrants = (await appeler('lister_appels', { sens: 'entrant', comptes: true })).json as { appels: { appelId: string }[]; comptes: { total: number } };
    expect(entrants.appels.map((a) => a.appelId)).toEqual([entrant.id]);
    expect(entrants.comptes.total).toBe(1);
    expect(((await appeler('lister_appels', { sens: 'sortant' })).json as { appels: { appelId: string }[] }).appels.map((a) => a.appelId)).toEqual([sortant.id]);
    expect(await appeler('lister_appels', { sens: 'rappel' })).toMatchObject({ erreur: true });

    expect((await appeler('lire_appel', { appelId: entrant.id })).json).toMatchObject({ appelId: entrant.id, sens: 'entrant', campagneId: null, numero: '06 39 98 00 01' });
    expect((await appeler('lire_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).json).toMatchObject({
      appels: [expect.objectContaining({ appelId: entrant.id, sens: 'entrant' }), expect.objectContaining({ appelId: sortant.id, sens: 'sortant' })],
    });
    expect((await appeler('lister_prospects', { entreprise: 'gite-fictif', recherche: 'julie' })).json).toMatchObject({
      prospects: [expect.objectContaining({ dernierAppel: expect.objectContaining({ appelId: entrant.id, sens: 'entrant' }) })],
    });
    const journee = (await appeler('lire_journee')).json as { appels: { id: string; sens: string }[]; appelsTelephone: { dernieres24h: number } };
    expect(journee.appels.map((a) => [a.id, a.sens])).toEqual([
      [entrant.id, 'entrant'],
      [sortant.id, 'sortant'],
    ]);
    // Le plafond du pont ne compte que les compositions.
    expect(journee.appelsTelephone.dernieres24h).toBe(1);
  });

  it('etat_ligne dit qu’un appel entrant sonne ou est en ligne', async () => {
    await pont.fermer();
    pont = await fauxPont({ etat: { appelEnCours: true, entrantEnCours: true, appelId: null, sens: 'entrant' } });
    const { appeler } = await connecter();

    expect((await appeler('etat_ligne')).json).toMatchObject({ appelEnCours: true, appelId: null, entrantEnCours: true, sens: 'entrant' });
  });

  it('lancer_appel ne pose pas la question pendant un appel entrant', async () => {
    await pont.fermer();
    pont = await fauxPont({ etat: { appelEnCours: true, entrantEnCours: true, appelId: null, sens: 'entrant' } });
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    expect(await appeler('lancer_appel', { entreprise: 'gite-fictif', prospect: 'julie', versionScriptId, ligne: 'bluetooth' })).toMatchObject({
      erreur: true,
      texte: 'Un appel est déjà en ligne sur le téléphone.',
    });
    expect(messages).toHaveLength(0);
    expect(pont.compositions()).toHaveLength(0);
  });

  it('lancer_campagne pendant un appel entrant : la campagne attend la ligne sans rien composer, et le dit', async () => {
    await pont.fermer();
    pont = await fauxPont({ etat: { appelEnCours: true, entrantEnCours: true, appelId: null, sens: 'entrant' } });
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    const { appeler } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_campagne', { campagneId });

    expect(r.json).toMatchObject({ statut: 'en-cours', appelEnCours: null, attente: { motif: 'ligne-occupee' } });
    expect(pont.compositions()).toHaveLength(0);
    const [c] = await db.select().from(campagnes).where(eq(campagnes.id, campagneId));
    expect(c?.entrees).toEqual([{ prospectId: 'julie', etat: 'a-appeler' }]);
  });
});
