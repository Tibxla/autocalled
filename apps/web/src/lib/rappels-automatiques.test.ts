import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, prospects } from '@/db/schema';
import { fauxPont } from '../../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche, opposer } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import * as appelsLib from './appels';
import { demarrerCampagne, enregistrerCampagne } from './campagnes';
import { creerScript } from './entreprises';
import { importerFiches } from './prospects';
import { activationRappelsAutomatiques, rappelSeraAutomatique, rappelerSiDu, rappelsAutomatiquesDus } from './rappels-automatiques';
import { rappelsDuJour } from './rappels';
import { enregistrerReglagesRappels, lireReglagesRappels } from './reglages-rappels';
import { compteRenduReveil, planReveil, reveiller } from './reveil';

avecBaseDeTest();

const maintenant = new Date('2030-04-02T10:00:00Z'); // Midi à Paris, sans dépendre de l'heure du lancement du test.
const activation = '2030-04-01T08:00:00Z';
let entrepriseId: string;
let versionScriptId: string;
let pont: Awaited<ReturnType<typeof fauxPont>>;

beforeEach(async () => {
  vi.stubEnv('RAPPELS_AUTOMATIQUES_DEPUIS', activation);
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
  pont = await fauxPont({ reglages: { pauseEntreAppelsS: 0 } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await pont.fermer();
  vi.unstubAllEnvs();
});

async function rappel(prospectId = 'julie', valeurs: Partial<typeof appels.$inferInsert> = {}) {
  const [a] = await db.insert(appels).values({
    entrepriseId,
    prospectId,
    versionScriptId,
    ligne: 'bluetooth',
    numero: '+33639980001',
    debutLe: new Date('2020-04-01T08:00:00Z'),
    statut: 'termine',
    issue: 'rappel-convenu',
    issueSysteme: 'rappel-convenu',
    rappelLe: new Date('2030-04-02T09:59:00Z'),
    ...valeurs,
  }).returning();
  if (!a) throw new Error('rappel fictif non enregistré');
  return a;
}

async function remplacerPont(configuration: Parameters<typeof fauxPont>[0]) {
  await pont.fermer();
  pont = await fauxPont(configuration);
}

describe('rappels convenus automatiques', () => {
  it('respecte les jours, horaires et la pause choisis dans l’interface, même hors de 9 h–19 h', async () => {
    const source = await rappel();
    const lu = await lireReglagesRappels();
    expect(await enregistrerReglagesRappels({ actif: true, jours: [2], debut: '20:00', fin: '21:00' }, lu.empreinte)).toMatchObject({ ok: true });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    const soir = new Date('2030-04-02T18:15:00Z');
    expect((await planReveil(soir)).aRappeler).toEqual([source.id]);
    const actif = await lireReglagesRappels();
    expect(await enregistrerReglagesRappels({ actif: false, jours: [2], debut: '20:00', fin: '21:00' }, actif.empreinte)).toMatchObject({ ok: true });
    expect(await rappelerSiDu(source.id, soir)).toBe(false);
    const pause = await lireReglagesRappels();
    await enregistrerReglagesRappels({ actif: true, jours: [2], debut: '20:00', fin: '21:00' }, pause.empreinte);
    expect((await reveiller(soir)).rappeles).toEqual([source.id]);
    expect(pont.compositions()).toHaveLength(1);
  });
  it('sans activation explicite valide, aucun appel ne part', async () => {
    const source = await rappel();
    for (const valeur of ['', 'une date', '2030-02-30T08:00:00Z', '2030-04-01']) {
      vi.stubEnv('RAPPELS_AUTOMATIQUES_DEPUIS', valeur);
      expect(activationRappelsAutomatiques()).toBeNull();
      expect(await rappelsAutomatiquesDus(maintenant)).toEqual([]);
      expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    }
    expect(pont.compositions()).toEqual([]);
  });

  it('garde les rappels échus depuis activation ; le passé, le futur et les essais restent manuels', async () => {
    const du = await rappel();
    await rappel('marc', { rappelLe: new Date('2030-04-03T10:00:00Z') });
    expect((await rappelsAutomatiquesDus(maintenant)).map((a) => a.appelId)).toEqual([du.id]);
    for (const valeurs of [
      { rappelLe: new Date('2030-03-31T10:00:00Z') },
      { rappelLe: null },
      { ligne: 'simulation' as const },
      { ligne: 'navigateur' as const },
      { statut: 'traitement' as const },
    ]) {
      await db.update(appels).set(valeurs).where(eq(appels.id, du.id));
      expect(await rappelerSiDu(du.id, maintenant)).toBe(false);
      await db.update(appels).set({ rappelLe: new Date('2030-04-02T09:59:00Z'), ligne: 'bluetooth', statut: 'termine' }).where(eq(appels.id, du.id));
    }
    expect(pont.compositions()).toEqual([]);
  });

  it('un appel plus récent l’annule : un sortant suffit, un entrant doit avoir une conversation', async () => {
    const source = await rappel();
    const [entrant] = await db.insert(appels).values({
      entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001',
      sens: 'entrant', statut: 'termine', debutLe: new Date('2020-04-02T08:00:00Z'),
    }).returning();
    expect((await rappelsAutomatiquesDus(maintenant)).map((a) => a.appelId)).toEqual([source.id]);
    await db.update(appels).set({ conversationId: 'conversation-fictive' }).where(eq(appels.id, entrant!.id));
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    await db.update(appels).set({ sens: 'sortant', conversationId: null, statut: 'echec' }).where(eq(appels.id, entrant!.id));
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(pont.compositions()).toEqual([]);
  });

  it('utilise la version source et annonce un rappel convenu, sans réciter l’ouverture de prospection', async () => {
    const source = await rappel();
    // Une autre version existe mais n'est pas celle de l'échange qui a convenu du rappel.
    await creerScript(entrepriseId, 'Nouveau script');
    expect(await rappelerSiDu(source.id, maintenant)).toBe(true);
    const compose = pont.compositions()[0]?.corps as { appelId: string; variables: { situation_appel: string }; ouverture?: string };
    expect(compose.variables.situation_appel).toContain('à l’heure convenue');
    expect(compose.ouverture).toBeUndefined();
    const [appel] = await db.select().from(appels).where(eq(appels.id, compose.appelId));
    expect(appel).toMatchObject({ versionScriptId, campagneId: null, sens: 'sortant', ligne: 'bluetooth' });
    // Même non abouti, le vrai départ consomme ce rendez-vous téléphonique.
    await db.update(appels).set({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti' }).where(eq(appels.id, compose.appelId));
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(pont.compositions()).toHaveLength(1);
  });

  it('deux réveils simultanés ne composent le même rappel qu’une fois', async () => {
    const source = await rappel();
    const resultats = await Promise.all([reveiller(maintenant), reveiller(maintenant)]);
    expect(resultats.flatMap((r) => r.rappeles)).toEqual([source.id]);
    expect(pont.compositions()).toHaveLength(1);
  });

  it('relit l’éligibilité après préparation : un entrant avec conversation arrivé entre-temps annule le départ', async () => {
    const source = await rappel();
    const preparerReel = appelsLib.preparerAppel;
    vi.spyOn(appelsLib, 'preparerAppel').mockImplementation(async (...argumentsAppel) => {
      const preparation = await preparerReel(...argumentsAppel);
      await db.insert(appels).values({
        entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001',
        sens: 'entrant', conversationId: 'conversation-fictive', debutLe: new Date('2020-04-02T08:00:00Z'),
      });
      return preparation;
    });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(pont.compositions()).toEqual([]);
  });

  it('l’appel est déjà visible en base quand le pont reçoit la composition et sa conversation', async () => {
    const source = await rappel();
    const fetchReel = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/appels')) {
        const { appelId } = JSON.parse(String(options?.body)) as { appelId: string };
        const [visible] = await db.select().from(appels).where(eq(appels.id, appelId));
        expect(visible).toBeDefined();
        await db.update(appels).set({ conversationId: 'conversation-immediate-fictive' }).where(eq(appels.id, appelId));
      }
      return fetchReel(url, options);
    });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(true);
  });

  it.each([
    { etat: { appelEnCours: true } },
    { etat: { entrantEnCours: true } },
    { plafond: 'Plafond fictif atteint' },
  ])('une ligne indisponible garde le rappel à faire (%j)', async (configuration) => {
    const source = await rappel();
    await remplacerPont(configuration);
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(await db.$count(appels)).toBe(1);
    expect((await rappelsAutomatiquesDus(maintenant)).map((a) => a.appelId)).toEqual([source.id]);
    expect(pont.compositions()).toEqual([]);
  });

  it.each([409, 429])('un refus HTTP %i avant composition garde le rappel pour le réveil suivant', async (statut) => {
    const source = await rappel();
    await remplacerPont({ refusAppels: { statut, erreur: 'Refus fictif avant composition' } });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(await db.$count(appels)).toBe(1);
    expect((await rappelsAutomatiquesDus(maintenant)).map((a) => a.appelId)).toEqual([source.id]);
    await remplacerPont({});
    expect(await rappelerSiDu(source.id, maintenant)).toBe(true);
  });

  it('un HTTP 503 conserve une trace incertaine : la composition GLib peut déjà avoir commencé', async () => {
    const source = await rappel();
    await remplacerPont({ refusAppels: { statut: 503, erreur: 'Timeout GLib fictif après programmation' } });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(await db.$count(appels)).toBe(2);
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(pont.compositions()).toHaveLength(1);
  });

  it('l’indication automatique inclut les échéances futures, mais pas les anciens rappels ni les jeux de rôle', () => {
    expect(rappelSeraAutomatique({ ligne: 'bluetooth', rappelLe: new Date(activation) })).toBe(true);
    expect(rappelSeraAutomatique({ ligne: 'bluetooth', rappelLe: new Date('2030-05-01T08:00:00Z') })).toBe(true);
    expect(rappelSeraAutomatique({ ligne: 'bluetooth', rappelLe: new Date('2030-03-01T08:00:00Z') })).toBe(false);
    expect(rappelSeraAutomatique({ ligne: 'bluetooth', rappelLe: null })).toBe(false);
    expect(rappelSeraAutomatique({ ligne: 'navigateur', rappelLe: new Date(activation) })).toBe(false);
  });

  it('une réponse réseau perdue conserve une trace incertaine et empêche une seconde composition', async () => {
    const source = await rappel();
    const fetchReel = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/appels')) throw new TypeError('Réponse fictive perdue après composition');
      return fetchReel(url, options);
    });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    const traces = await db.select().from(appels);
    expect(traces).toHaveLength(2);
    expect(traces.find((a) => a.id !== source.id)).toMatchObject({ statut: 'echec', erreur: expect.stringContaining('Composition incertaine') });
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
  });

  it('respecte l’archivage et la liste d’opposition au dernier moment', async () => {
    const source = await rappel();
    await db.update(prospects).set({ archiveLe: new Date() }).where(eq(prospects.id, 'julie'));
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    await db.update(prospects).set({ archiveLe: null }).where(eq(prospects.id, 'julie'));
    await opposer('+33639980001');
    expect(await rappelerSiDu(source.id, maintenant)).toBe(false);
    expect(await db.$count(appels)).toBe(1);
    expect(pont.compositions()).toEqual([]);
  });

  it('attend 9 h - 19 h Paris même quand le rappel est dû ; relancer false reste sans composition', async () => {
    const source = await rappel();
    for (const instant of ['2030-04-02T06:59:00Z', '2030-04-02T17:00:00Z', '2030-04-02T22:00:00Z']) {
      expect(await rappelerSiDu(source.id, new Date(instant))).toBe(false);
      expect((await reveiller(new Date(instant))).rappeles).toEqual([]);
    }
    expect((await reveiller(maintenant, { relancer: false })).rappeles).toEqual([]);
    expect(pont.compositions()).toEqual([]);
  });

  it('un rappel dû ne dépend plus de la campagne source terminée', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    await db.update(campagnes).set({ statut: 'terminee' }).where(eq(campagnes.id, campagneId));
    const source = await rappel('julie', { campagneId });
    expect((await reveiller(maintenant)).rappeles).toEqual([source.id]);
    expect(pont.compositions()).toHaveLength(1);
  });

  it('le réveil compose le rappel dû avant le premier appel d’une campagne', async () => {
    await rappel();
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['marc'] });
    await demarrerCampagne(campagneId);
    const configuration = { etat: {} as Record<string, unknown> };
    await remplacerPont(configuration);
    const fetchReel = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const reponse = await fetchReel(url, options);
      if (String(url).endsWith('/appels')) configuration.etat.appelEnCours = true;
      return reponse;
    });
    await reveiller(maintenant);
    expect(pont.compositions()).toHaveLength(1);
    expect(pont.compositions()[0]?.corps).toMatchObject({ numero: '+33639980001' });
  });

  it('le plan est garanti en lecture seule et son compte rendu ne contient aucune identité', async () => {
    const source = await rappel();
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return planReveil(maintenant, tx);
    });
    expect(plan.aRappeler).toEqual([source.id]);
    expect(await db.$count(appels)).toBe(1);
    expect(pont.requetes).toEqual([]);
    const compte = compteRenduReveil({ classes: 0, relancees: [], orphelins: 0, rappeles: plan.aRappeler }, true);
    expect(compte).toContain('Rappels convenus à appeler : 1.');
    expect(compte).not.toContain('Julie');
    expect(compte).not.toContain(source.id);
    expect(compte).not.toContain('+336');
    // Lecture manuelle inchangée, indépendamment de l'activation automatique.
    vi.stubEnv('RAPPELS_AUTOMATIQUES_DEPUIS', '');
    const manuel = await rappelsDuJour();
    expect(manuel.sansDate).toBe(0);
  });
});
