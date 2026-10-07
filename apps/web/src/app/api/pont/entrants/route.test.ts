import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, prospects } from '@/db/schema';
import * as agenda from '@/lib/agenda';
import { creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
import { enregistrerReglagesEntrants, lireReglagesEntrants } from '@/lib/reglages-entrants';
import { agendaFrais, entrepriseDeTest, fiche, opposer } from '../../../../../test/fixtures';
import { avecBaseDeTest } from '../../../../../test/outils';
import { POST } from './route';

avecBaseDeTest();

const NUMERO = '+33639980001';

function entrant(corps: unknown, secret = 'Bearer secret-de-test') {
  return POST(
    new Request('http://127.0.0.1/api/pont/entrants', {
      method: 'POST',
      headers: { authorization: secret, 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
  );
}

type Reponse = { decrocher: boolean; appelId?: string; variables?: Record<string, string>; motsCles?: string[]; premierMessage?: string };
const lire = async (r: Response) => (await r.json()) as Reponse;

let entrepriseId: string;
let versionScriptId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
});

/** Un appel sortant passé vers un prospect de l'entreprise de test (par défaut : téléphone, sans réponse, hier). */
async function appelSortant(valeurs: Partial<typeof appels.$inferInsert> = {}) {
  const [a] = await db
    .insert(appels)
    .values({
      entrepriseId,
      prospectId: 'julie',
      versionScriptId,
      ligne: 'bluetooth',
      numero: NUMERO,
      statut: 'termine',
      issue: 'non-abouti',
      issueSysteme: 'non-abouti',
      debutLe: new Date(Date.now() - 86_400_000),
      ...valeurs,
    })
    .returning();
  if (!a) throw new Error('appel de test non créé');
  return a;
}

describe('appel entrant d’un prospect déjà appelé', () => {
  it('une suspension pendant la préparation laisse sonner sans enregistrer d’appel', async () => {
    await appelSortant();
    const initial = await lireReglagesEntrants();
    const relecture = vi.spyOn(agenda, 'rafraichirSiAncien').mockImplementationOnce(async () => {
      await enregistrerReglagesEntrants({ ...initial.valeur, actif: false }, initial.empreinte);
    });
    try {
      expect(await lire(await entrant({ numero: NUMERO }))).toEqual({ decrocher: false });
      expect(await db.$count(appels)).toBe(1);
    } finally {
      relecture.mockRestore();
    }
  });

  it('l’opérateur peut laisser sonner un prospect connu, puis choisir un accueil entrant distinct', async () => {
    await appelSortant();
    const initial = await lireReglagesEntrants();
    expect(await enregistrerReglagesEntrants({ actif: false, accueil: initial.valeur.accueil }, initial.empreinte)).toMatchObject({ ok: true });
    expect(await lire(await entrant({ numero: NUMERO }))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(1);
    const desactive = await lireReglagesEntrants();
    expect(await enregistrerReglagesEntrants({ actif: true, accueil: 'Bonjour, {{assistante_nom}} à votre écoute.' }, desactive.empreinte)).toMatchObject({ ok: true });
    expect(await lire(await entrant({ numero: NUMERO }))).toMatchObject({ decrocher: true, premierMessage: 'Bonjour, Mina à votre écoute.' });
  });

  it('décroche : appel enregistré (entrant, sans campagne, version du dernier sortant), variables et accueil composés', async () => {
    await appelSortant();

    const r = await lire(await entrant({ numero: '0639980001' }));

    expect(r).toMatchObject({ decrocher: true, appelId: expect.stringMatching(/^[0-9a-f-]{36}$/), premierMessage: 'Allô, oui bonjour, Mina à l\'appareil.' });
    expect(r.variables?.situation_appel).toMatch(/^C'est Julie Fictive qui te rappelle, après ton appel d'hier, resté sans réponse\./);
    expect(r.variables?.prospect_nom).toBe('Julie Fictive');
    expect(r.motsCles).toContain('Julie Fictive');
    const [enregistre] = await db.select().from(appels).where(eq(appels.id, r.appelId ?? ''));
    expect(enregistre).toMatchObject({
      entrepriseId,
      prospectId: 'julie',
      versionScriptId,
      campagneId: null,
      ligne: 'bluetooth',
      sens: 'entrant',
      numero: NUMERO,
      statut: 'en-cours',
      assistanteNom: 'Mina',
    });
  });

  it('dit seulement « après ton appel » quand le dernier sortant a eu une conversation', async () => {
    await appelSortant({ issue: 'interrompu', issueSysteme: 'interrompu', debutLe: new Date() });

    const r = await lire(await entrant({ numero: NUMERO }));

    expect(r.variables?.situation_appel).toMatch(/^C'est Julie Fictive qui te rappelle, après ton appel d'aujourd'hui\. /);
  });

  it('numéro partagé par deux entreprises : le prospect appelé le plus récemment, avec la version de son appel', async () => {
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    await importerFiches(autre.id, [fiche('jules', 'Jules Fictif', '06 39 98 00 01')]);
    const { versionScriptId: autreVersion } = await creerScript(autre.id, 'Autre');
    await appelSortant({ debutLe: new Date(Date.now() - 3 * 86_400_000) });
    await appelSortant({ entrepriseId: autre.id, prospectId: 'jules', versionScriptId: autreVersion, debutLe: new Date(Date.now() - 2 * 86_400_000) });
    // Plus récent, mais ni la ligne navigateur ni la simulation n'ont fait sonner un téléphone.
    await appelSortant({ ligne: 'navigateur', debutLe: new Date() });

    const r = await lire(await entrant({ numero: NUMERO }));

    const [enregistre] = await db.select().from(appels).where(eq(appels.id, r.appelId ?? ''));
    expect(enregistre).toMatchObject({ entrepriseId: autre.id, prospectId: 'jules', versionScriptId: autreVersion, sens: 'entrant' });
  });

  it('décroche malgré un appel « en cours » de plus d’une heure (orphelin d’un redémarrage du pont)', async () => {
    await appelSortant();
    await appelSortant({ prospectId: 'marc', numero: '+33639980002', statut: 'en-cours', issue: null, issueSysteme: null, debutLe: new Date(Date.now() - 2 * 3_600_000) });

    expect(await lire(await entrant({ numero: NUMERO }))).toMatchObject({ decrocher: true });
  });
});

describe('on laisse sonner, rien n’est écrit', () => {
  it.each([
    ['numéro masqué', { numero: 'withheld' }],
    ['numéro vide', { numero: '' }],
    ['numéro absent', {}],
    ['numéro illisible', { numero: '12' }],
  ])('%s', async (_, corps) => {
    await appelSortant();
    const avant = await db.$count(appels);

    expect(await lire(await entrant(corps))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(avant);
  });

  it('numéro inconnu de toutes les entreprises', async () => {
    expect(await lire(await entrant({ numero: '+33639980099' }))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(0);
  });

  it('prospect connu mais jamais appelé au téléphone (seulement en simulation ou navigateur)', async () => {
    await appelSortant({ ligne: 'simulation' });
    await appelSortant({ ligne: 'navigateur' });

    expect(await lire(await entrant({ numero: NUMERO }))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(2);
  });

  it('prospect archivé', async () => {
    await appelSortant();
    await db.update(prospects).set({ archiveLe: new Date() }).where(eq(prospects.id, 'julie'));

    expect(await lire(await entrant({ numero: NUMERO }))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(1);
  });

  it('numéro dans la liste d’opposition', async () => {
    await appelSortant();
    await opposer(NUMERO);

    expect(await lire(await entrant({ numero: NUMERO }))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(1);
  });

  it('un appel téléphone déjà en cours en base : une seule ligne', async () => {
    await appelSortant();
    await appelSortant({ prospectId: 'marc', numero: '+33639980002', statut: 'en-cours', issue: null, issueSysteme: null, debutLe: new Date() });

    expect(await lire(await entrant({ numero: NUMERO }))).toEqual({ decrocher: false });
    expect(await db.$count(appels)).toBe(2);
  });

  it('refuse une requête sans le secret du pont', async () => {
    await appelSortant();

    expect((await entrant({ numero: NUMERO }, 'Bearer faux')).status).toBe(401);
    expect(await db.$count(appels)).toBe(1);
  });
});
