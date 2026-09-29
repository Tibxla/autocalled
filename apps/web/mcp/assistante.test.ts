import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { assistante, journalMcp, versionsAssistante } from '@/db/schema';
import { importerFiches } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { dossierAgentDeTest, type FauxClient, fauxClientAgent, PROMPT_DE_TEST } from '../test/faux-agent';
import { entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let client: Client | undefined;
let faux: FauxClient;
let agent: Awaited<ReturnType<typeof dossierAgentDeTest>>;

beforeEach(async () => {
  faux = fauxClientAgent();
  agent = await dossierAgentDeTest(faux);
});
afterEach(async () => {
  await client?.fermer();
  client = undefined;
  await agent.effacer();
});

async function connecter(elicitation?: 'accepter' | 'refuser') {
  client = await clientDeTest({ elicitation, clientAgent: faux, dossierAgent: agent.dossier });
  return client;
}

type Vue = { nom: string; premierMessage: string; modifieLe: string | null; prompt: string; reglages: Record<string, unknown>; synchro: { empreinteLocale: string; distante: unknown } };
const lire = async (c: Client) => (await c.appeler('lire_assistante')).json as Vue;
const promptLocal = () => readFile(join(agent.dossier, 'prompt.md'), 'utf8');

describe('lire_assistante', () => {
  it('rend le nom et le premier message par défaut, le prompt, les réglages, la lecture seule et la synchronisation', async () => {
    const c = await connecter();

    const vue = (await c.appeler('lire_assistante')).json;

    expect(vue).toMatchObject({
      nom: 'Mina',
      premierMessage: 'Allô ?',
      modifieLe: null,
      prompt: PROMPT_DE_TEST,
      reglages: { temperature: 0.7, voix: { voiceId: 'voixfictive0001' } },
      lectureSeule: { langue: 'fr', firstMessage: '' },
      variablesDisponibles: expect.arrayContaining(['assistante_nom']),
      synchro: { distante: { versionId: 'agtvrsn_test1' }, modificationsLocalesNonPoussees: false },
    });
  });

  it('dit pourquoi ElevenLabs ne répond pas, sans échouer', async () => {
    faux.panne = true;
    const c = await connecter();

    expect((await lire(c)).synchro).toMatchObject({ distante: null, erreurDistante: expect.stringContaining('réseau coupé') });
  });
});

describe('modifier_assistante', () => {
  it('demande l’accord avec l’ancien et le nouveau nom et les consentements v1, puis vaut dès l’aperçu suivant', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const c = await connecter('accepter');

    const r = await c.appeler('modifier_assistante', { nom: 'Léa', premierMessage: 'Bonjour, {{prospect_nom}} ?' });

    expect(c.messages[0]).toBe(
      'Changer le nom de l’assistante : « Mina » → « Léa ». Changer son premier message, dit quand le prospect se tait au décroché : « Allô ? » → « Bonjour, {{prospect_nom}} ? ». Les prospects l’entendront dès le prochain appel, sans autre relecture.',
    );
    expect(r.json).toMatchObject({ nom: 'Léa', premierMessage: 'Bonjour, {{prospect_nom}} ?', rappel: expect.stringContaining('libellé du tableau de bord ElevenLabs reste « Assistante de test »') });
    expect(await db.select({ nom: assistante.nom, modifiePar: assistante.modifiePar }).from(assistante)).toEqual([{ nom: 'Léa', modifiePar: 'mcp' }]);
    expect((await c.appeler('apercu_variables_appel', { entreprise: 'gite-fictif', prospect: 'julie' })).json).toMatchObject({
      variables: { assistante_nom: 'Léa' },
      premierMessage: 'Bonjour, Julie Fictive ?',
    });
  });

  it('ne change rien sans accord, et refuse sans rien demander un nom invalide, une variable inconnue ou une lecture périmée', async () => {
    const c = await connecter('refuser');

    expect((await c.appeler('modifier_assistante', { nom: 'Léa' })).erreur).toBe(true);
    expect(await db.$count(assistante)).toBe(0);
    const avant = c.messages.length;
    expect(await c.appeler('modifier_assistante', { nom: 'le service des impôts' })).toMatchObject({ erreur: true, texte: expect.stringContaining('Nom refusé') });
    expect(await c.appeler('modifier_assistante', { premierMessage: 'Bonjour {{inconnue}}' })).toMatchObject({ erreur: true, texte: expect.stringContaining('Variables inconnues') });
    expect(await c.appeler('modifier_assistante', { nom: 'Mina' })).toMatchObject({ erreur: true, texte: expect.stringContaining('Rien ne change') });
    expect(await c.appeler('modifier_assistante', { nom: 'Léa', connu: '2026-01-01T00:00:00.000Z' })).toMatchObject({ erreur: true, texte: expect.stringContaining('a changé depuis ta lecture') });
    expect(c.messages.length).toBe(avant);
  });
});

describe('modifier_prompt_assistante et modifier_reglages_assistante', () => {
  it('écrit agent/ par remplacements exacts, sans rien pousser, et ne garde au journal que des passages coupés', async () => {
    const c = await connecter();
    const { synchro } = await lire(c);
    const long = `${'x'.repeat(400)}`;

    const r = await c.appeler('modifier_prompt_assistante', {
      remplacements: [{ avant: 'Refus ferme : tu remercies et tu raccroches.', apres: `Refus ferme : tu remercies, puis tu raccroches poliment. ${long}` }],
      empreinteConnue: synchro.empreinteLocale,
    });

    expect(r.json).toMatchObject({ lignesModifiees: 2, rappel: expect.stringContaining('git diff agent/') });
    expect(await promptLocal()).toContain('tu raccroches poliment');
    expect(faux.modifications).toBe(0);
    const [ligne] = await db.select().from(journalMcp).where(eq(journalMcp.outil, 'modifier_prompt_assistante'));
    expect(JSON.stringify(ligne?.arguments).length).toBeLessThan(900);
  });

  it('refuse un prompt qui perd une variable ou sa section Règles, et une empreinte périmée', async () => {
    const c = await connecter();
    const { synchro } = await lire(c);

    expect(
      await c.appeler('modifier_prompt_assistante', { remplacements: [{ avant: '{{prospect_nom}}', apres: 'le prospect' }], empreinteConnue: synchro.empreinteLocale }),
    ).toMatchObject({ erreur: true, texte: expect.stringContaining('Prompt refusé') });
    expect(await c.appeler('modifier_prompt_assistante', { remplacements: [{ avant: '# Règles', apres: '# Notes' }], empreinteConnue: synchro.empreinteLocale })).toMatchObject({
      erreur: true,
    });
    expect(await c.appeler('modifier_reglages_assistante', { reglages: { temperature: 0.5 }, empreinteConnue: 'perimee' })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('relis avec lire_assistante'),
    });
    expect(await promptLocal()).toBe(PROMPT_DE_TEST);
  });

  it('écrit un réglage de la liste, refuse une valeur hors bornes ou une clé inconnue', async () => {
    const c = await connecter();
    const { synchro } = await lire(c);

    expect((await c.appeler('modifier_reglages_assistante', { reglages: { temperature: 0.5, voix: { vitesse: 1.1 } }, empreinteConnue: synchro.empreinteLocale })).json).toMatchObject({
      champs: ['temperature', 'voix.vitesse'],
    });
    expect((await lire(c)).reglages).toMatchObject({ temperature: 0.5, voix: { vitesse: 1.1 } });
    const { synchro: apres } = await lire(c);
    expect((await c.appeler('modifier_reglages_assistante', { reglages: { dureeMaxS: 600 }, empreinteConnue: apres.empreinteLocale })).erreur).toBe(true);
    expect((await c.appeler('modifier_reglages_assistante', { reglages: { first_message: 'Bonjour' }, empreinteConnue: apres.empreinteLocale })).erreur).toBe(true);
  });
});

describe('pousser_assistante', () => {
  async function modifierTemperature(c: Client) {
    const { synchro } = await lire(c);
    await c.appeler('modifier_reglages_assistante', { reglages: { temperature: 0.5 }, empreinteConnue: synchro.empreinteLocale });
  }

  it('montre la différence rédigée par le serveur, pousse après l’accord, consigne les deux versions', async () => {
    const c = await connecter('accepter');
    await modifierTemperature(c);

    const r = await c.appeler('pousser_assistante');

    expect(c.messages[0]).toBe('Pousser vers ElevenLabs la configuration de l’assistante. Elle servira dès le prochain appel.\n\nRéglages :\n  température : 0,7 → 0,5');
    expect(r.json).toMatchObject({ versionAvant: 'agtvrsn_test1', versionApres: 'agtvrsn_test2' });
    expect(faux.modifications).toBe(1);
    expect(await db.select({ versionId: versionsAssistante.versionId, origine: versionsAssistante.origine }).from(versionsAssistante).orderBy(versionsAssistante.versionId)).toEqual([
      { versionId: 'agtvrsn_test1', origine: 'cli' },
      { versionId: 'agtvrsn_test2', origine: 'mcp' },
    ]);
    const [ligne] = await db.select().from(journalMcp).where(eq(journalMcp.outil, 'pousser_assistante')).orderBy(desc(journalMcp.le)).limit(1);
    expect(ligne).toMatchObject({ resultat: 'ok', confirmation: 'acceptee', message: 'version agtvrsn_test1 → agtvrsn_test2' });
    expect((await c.appeler('pousser_assistante')).texte).toBe('Rien à pousser : agent/ est identique à la configuration ElevenLabs.');
  });

  it('ne pousse rien si l’opérateur refuse', async () => {
    const c = await connecter('refuser');
    await modifierTemperature(c);

    expect((await c.appeler('pousser_assistante')).erreur).toBe(true);
    expect(faux.modifications).toBe(0);
    expect(await db.$count(versionsAssistante)).toBe(0);
  });

  it('refuse sans rien demander un champ hors de la liste du MCP, et une configuration modifiée ailleurs', async () => {
    const c = await connecter('accepter');
    const chemin = join(agent.dossier, 'mina.config.json');
    const config = JSON.parse(await readFile(chemin, 'utf8'));
    config.conversation_config.agent.first_message = 'Bonjour !';
    await writeFile(chemin, JSON.stringify(config, null, 2));

    expect(await c.appeler('pousser_assistante')).toMatchObject({ erreur: true, texte: expect.stringContaining('pnpm agent push') });
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau' };
    expect(await c.appeler('pousser_assistante')).toMatchObject({ erreur: true, texte: expect.stringContaining('rapatrier_assistante d’abord') });
    expect(c.messages).toHaveLength(0);
    expect(faux.modifications).toBe(0);
  });
});

describe('rapatrier, historique, restaurer', () => {
  it('rapatrie une modification du tableau de bord, la consigne, puis revient en arrière par une restauration à pousser', async () => {
    const c = await connecter('accepter');
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau', name: 'Libellé changé' };

    expect((await c.appeler('rapatrier_assistante')).json).toMatchObject({ versionId: 'agtvrsn_tableau' });
    expect((await lire(c)).reglages).toMatchObject({ libelleTableauDeBord: 'Libellé changé' });
    await db.insert(versionsAssistante).values({ versionId: 'agtvrsn_test1', empreinte: 'x', prompt: PROMPT_DE_TEST, configuration: { name: 'Assistante de test' }, origine: 'cli' });

    const historique = (await c.appeler('historique_assistante')).json as { versionId: string; estLeVerrou: boolean }[];
    expect(historique.map((h) => [h.versionId, h.estLeVerrou]).sort()).toEqual([
      ['agtvrsn_tableau', true],
      ['agtvrsn_test1', false],
    ]);
    expect((await c.appeler('historique_assistante', { versionId: 'agtvrsn_test1' })).json).toMatchObject({ differenceAvecLocal: expect.stringContaining('Libellé changé') });

    expect((await c.appeler('restaurer_assistante', { versionId: 'agtvrsn_test1' })).json).toMatchObject({ rappel: expect.stringContaining('pousser_assistante') });
    expect((await lire(c)).reglages).toMatchObject({ libelleTableauDeBord: 'Assistante de test' });
    expect(faux.modifications).toBe(0);
    expect((await c.appeler('restaurer_assistante', { versionId: 'agtvrsn_inconnue' })).erreur).toBe(true);
  });
});
