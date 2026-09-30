import { asc } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { assistante, journalMcp, versionsAssistante } from '@/db/schema';
import { dossierAgentDeTest, type FauxClient, fauxClientAgent, PROMPT_DE_TEST } from '../../test/faux-agent';
import { avecBaseDeTest } from '../../test/outils';
import {
  derniersGestesAssistante,
  enregistrerIdentite,
  enregistrerReglagesAssistante,
  JOURNAL_INDISPONIBLE,
  lireEditionAssistante,
  pousser,
  preparerIdentite,
  preparerPoussee,
  rapatrier,
  restaurer,
} from './edition-assistante';
import { noterAuJournal } from './journal';
import { journalMcpRecent } from './lecture';

/**
 * Le journal des gestes (ADR 0016) : les gestes de la page Assistante y entrent au format des lignes du MCP, d'origine
 * « interface » ; un geste confirmé ne part pas sans sa trace ; une préparation n'y entre pas.
 */

avecBaseDeTest();

let faux: FauxClient;
let agent: Awaited<ReturnType<typeof dossierAgentDeTest>>;
let o: { client: FauxClient; dossier: string };

beforeEach(async () => {
  faux = fauxClientAgent();
  agent = await dossierAgentDeTest(faux);
  o = { client: faux, dossier: agent.dossier };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await agent.effacer();
});

const journal = () =>
  db
    .select({
      origine: journalMcp.origine,
      outil: journalMcp.outil,
      arguments: journalMcp.arguments,
      resultat: journalMcp.resultat,
      message: journalMcp.message,
      confirmation: journalMcp.confirmation,
    })
    .from(journalMcp)
    .orderBy(asc(journalMcp.le));

/** Le journal refuse toute écriture ; les autres tables répondent. */
function journalEnPanne() {
  const insert = db.insert.bind(db);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(db, 'insert').mockImplementation(((table: Parameters<typeof db.insert>[0]) => {
    if (table === journalMcp) throw new Error('journal hors service');
    return insert(table);
  }) as typeof db.insert);
}

async function modifierTemperature(valeur = 0.5) {
  const { empreinteLocale } = await lireEditionAssistante(o);
  return enregistrerReglagesAssistante({ temperature: valeur }, empreinteLocale, o);
}

describe('gestes journalisés', () => {
  it('nom et premier message : la question lue, puis le résultat avec l’accord, l’ancien et le nouveau texte', async () => {
    await preparerIdentite({ nom: 'Léa' }, null);
    expect(await journal()).toEqual([]);

    expect(await enregistrerIdentite({ nom: 'Léa' }, null, o)).toMatchObject({ ok: true });

    const question = 'Changer le nom de l’assistante : « Mina » → « Léa ». Les prospects l’entendront dès le prochain appel, sans autre relecture.';
    const args = { nomAvant: 'Mina', nom: 'Léa' };
    expect(await journal()).toEqual([
      { origine: 'interface', outil: 'modifier_assistante', arguments: args, resultat: 'confirmation-demandee', message: question, confirmation: null },
      { origine: 'interface', outil: 'modifier_assistante', arguments: args, resultat: 'ok', message: null, confirmation: 'acceptee' },
    ]);
  });

  it('réglages : une ligne, chaque réglage avec sa valeur avant et après, sans question', async () => {
    const { empreinteLocale } = await lireEditionAssistante(o);

    await enregistrerReglagesAssistante({ temperature: 0.5, voix: { vitesse: 1.1 } }, empreinteLocale, o);

    expect(await journal()).toEqual([
      {
        origine: 'interface',
        outil: 'modifier_reglages_assistante',
        arguments: { changements: { temperature: { avant: 0.7, apres: 0.5 }, 'voix.vitesse': { avant: 1, apres: 1.1 } } },
        resultat: 'ok',
        message: null,
        confirmation: null,
      },
    ]);
  });

  it('poussée : la préparation n’entre pas au journal ; le geste garde la question du MCP et les versions', async () => {
    await modifierTemperature();
    await db.delete(journalMcp);
    const prep = await preparerPoussee(o);
    if (!prep.ok) throw new Error(prep.raison);
    expect(await journal()).toEqual([]);

    await pousser(prep.attendu, o);

    const [demande, fait] = await journal();
    expect(demande).toMatchObject({ outil: 'pousser_assistante', resultat: 'confirmation-demandee', arguments: { versionDistante: 'agtvrsn_test1' } });
    expect(demande?.message).toContain(prep.question);
    expect(demande?.message).toContain('température : 0,7 → 0,5');
    expect(fait).toMatchObject({ origine: 'interface', resultat: 'ok', message: 'version agtvrsn_test1 → agtvrsn_test2', confirmation: 'acceptee' });
  });

  it('rapatriement et restauration : la question affichée, la version rapatriée ou restaurée', async () => {
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau', name: 'Libellé changé' };
    await rapatrier(o);
    await db.insert(versionsAssistante).values({ versionId: 'agtvrsn_test1', empreinte: 'x', prompt: PROMPT_DE_TEST, configuration: { name: 'Assistante de test' }, origine: 'mcp' });
    await restaurer('agtvrsn_test1', o);

    const lignes = await journal();
    expect(lignes.map((l) => [l.outil, l.resultat, l.confirmation])).toEqual([
      ['rapatrier_assistante', 'confirmation-demandee', null],
      ['rapatrier_assistante', 'ok', 'acceptee'],
      ['restaurer_assistante', 'confirmation-demandee', null],
      ['restaurer_assistante', 'ok', 'acceptee'],
    ]);
    expect(lignes[0]?.message).toMatch(/^Réécrire agent\/ d’après ElevenLabs \?/);
    expect(lignes[1]?.message).toBe('version agtvrsn_tableau');
    expect(lignes[2]).toMatchObject({ arguments: { versionId: 'agtvrsn_test1' }, message: expect.stringContaining('Restaurer cette version dans agent/ ? Version agtvrsn_test1.') });
    expect(lignes[2]?.message).toContain('Libellé changé');
  });
});

describe('refus journalisés', () => {
  it('garde la raison d’un refus, avant la question comme après l’accord', async () => {
    await enregistrerIdentite({ nom: 'le service des impôts' }, null, o);
    await modifierTemperature();
    // agent/ contient une modification non poussée : le rapatriement, accepté, est refusé ensuite.
    await rapatrier(o);
    await restaurer('agtvrsn_inconnue', o);

    const refus = (await journal()).filter((l) => l.resultat === 'refus');
    expect(refus).toEqual([
      expect.objectContaining({ outil: 'modifier_assistante', arguments: { nom: 'le service des impôts' }, message: expect.stringContaining('Nom refusé'), confirmation: null }),
      expect.objectContaining({ outil: 'rapatrier_assistante', message: expect.stringContaining('La page ne tranche pas'), confirmation: 'acceptee' }),
      expect.objectContaining({
        outil: 'restaurer_assistante',
        arguments: { versionId: 'agtvrsn_inconnue' },
        message: 'Cette version n’est pas consignée : l’historique liste celles qui le sont.',
        confirmation: null,
      }),
    ]);
    expect(refus.every((l) => l.origine === 'interface')).toBe(true);
  });

  it('une poussée dont la différence a changé depuis la question : refusée sans question gardée', async () => {
    await modifierTemperature();
    const prep = await preparerPoussee(o);
    if (!prep.ok) throw new Error(prep.raison);
    await modifierTemperature(0.3);
    await db.delete(journalMcp);

    expect(await pousser(prep.attendu, o)).toMatchObject({ ok: false });

    expect(await journal()).toEqual([
      expect.objectContaining({ outil: 'pousser_assistante', resultat: 'refus', message: 'La configuration a changé depuis la question : rien n’est parti, relis la différence.' }),
    ]);
    expect(faux.modifications).toBe(0);
  });

  it('une exception : la page reçoit une phrase, le journal garde le détail', async () => {
    await modifierTemperature();
    const prep = await preparerPoussee(o);
    if (!prep.ok) throw new Error(prep.raison);
    faux.modifier = async () => {
      throw new Error('ElevenLabs 500');
    };

    expect(await pousser(prep.attendu, o)).toEqual({ ok: false, raison: 'Échec : ElevenLabs 500' });
    expect((await journal()).at(-1)).toMatchObject({ outil: 'pousser_assistante', resultat: 'erreur', message: 'ElevenLabs 500', confirmation: 'acceptee' });
  });
});

describe('sans journal, pas de geste confirmé', () => {
  it('le nom ne change pas', async () => {
    journalEnPanne();
    expect(await enregistrerIdentite({ nom: 'Léa' }, null, o)).toEqual({ ok: false, raison: JOURNAL_INDISPONIBLE });
    vi.restoreAllMocks();
    expect(await db.$count(assistante)).toBe(0);
    expect(await journal()).toEqual([]);
  });

  it('rien ne part vers ElevenLabs', async () => {
    await modifierTemperature();
    const prep = await preparerPoussee(o);
    if (!prep.ok) throw new Error(prep.raison);
    journalEnPanne();

    expect(await pousser(prep.attendu, o)).toEqual({ ok: false, raison: JOURNAL_INDISPONIBLE });
    expect(faux.modifications).toBe(0);
  });

  it('agent/ n’est ni rapatrié ni restauré', async () => {
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau', name: 'Libellé changé' };
    await db.insert(versionsAssistante).values({ versionId: 'agtvrsn_ancienne', empreinte: 'x', prompt: PROMPT_DE_TEST, configuration: { name: 'Ancien libellé' }, origine: 'mcp' });
    const avant = await lireEditionAssistante(o);
    journalEnPanne();

    expect(await rapatrier(o)).toEqual({ ok: false, raison: JOURNAL_INDISPONIBLE });
    expect(await restaurer('agtvrsn_ancienne', o)).toEqual({ ok: false, raison: JOURNAL_INDISPONIBLE });
    vi.restoreAllMocks();
    expect((await lireEditionAssistante(o)).empreinteLocale).toBe(avant.empreinteLocale);
  });
});

describe('lecture par origine', () => {
  it('filtre par origine, et la page Assistante lit ses cinq derniers gestes, sans lecture ni question', async () => {
    await noterAuJournal({ origine: 'mcp', outil: 'lire_assistante', arguments: {}, resultat: 'ok', message: null, confirmation: null });
    await noterAuJournal({ origine: 'mcp', outil: 'modifier_prompt_assistante', arguments: {}, resultat: 'ok', message: null, confirmation: null });
    await noterAuJournal({ origine: 'mcp', outil: 'lancer_appel', arguments: {}, resultat: 'refus', message: 'Hors plage.', confirmation: null });
    await enregistrerIdentite({ nom: 'Léa' }, null, o);

    expect((await journalMcpRecent(10, { origine: 'interface' })).map((l) => l.resultat)).toEqual(['ok', 'confirmation-demandee']);
    expect((await journalMcpRecent(10, { origine: 'mcp' })).map((l) => l.outil).sort()).toEqual(['lancer_appel', 'lire_assistante', 'modifier_prompt_assistante']);
    // Les lignes déjà là avant la migration 0017 sont celles du MCP : la colonne vaut `mcp` par défaut.
    await db.insert(journalMcp).values({ outil: 'lister_entreprises', arguments: {}, resultat: 'ok' });
    expect((await journalMcpRecent(1, { outil: 'lister_entreprises' }))[0]?.origine).toBe('mcp');

    const gestes = await derniersGestesAssistante();
    expect(gestes.map((l) => [l.origine, l.outil])).toEqual([
      ['interface', 'modifier_assistante'],
      ['mcp', 'modifier_prompt_assistante'],
    ]);
    for (let i = 0; i < 6; i++) await noterAuJournal({ origine: 'mcp', outil: 'modifier_reglages_assistante', arguments: {}, resultat: 'ok', message: null, confirmation: null });
    expect(await derniersGestesAssistante()).toHaveLength(5);
  });
});
