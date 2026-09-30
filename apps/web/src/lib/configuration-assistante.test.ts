import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ClientAgent, enregistrerDistante, type Json } from '@autocalled/agent';
import { VARIABLES_DE_L_APPEL } from '@autocalled/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, versionsAssistante } from '@/db/schema';
import { entrepriseDeTest } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import {
  historiqueAssistante,
  lireConfigurationAssistante,
  modifierPromptAssistante,
  modifierReglagesAssistante,
  preparerPousseeAssistante,
  pousserAssistante,
  rapatrierAssistante,
  restaurerAssistante,
  versionAssistante,
} from './configuration-assistante';
import { creerScript } from './entreprises';

avecBaseDeTest();

/** Un prompt de test construit sur les variables de l'application, jamais recopié de agent/prompt.md. */
const PROMPT = [
  '# Personnalité',
  '',
  'Tu es {{assistante_nom}}, une assistante de test.',
  '',
  '# Ce que tu sais',
  '',
  ...VARIABLES_DE_L_APPEL.filter((v) => v !== 'assistante_nom').map((v) => `- ${v} : {{${v}}}`),
  '',
  'Tu parles simplement, en phrases courtes, et tu écoutes la personne avant de répondre. '.repeat(4),
  '',
  '# Règles',
  '',
  '- Refus ferme : tu remercies et tu raccroches.',
  '',
].join('\n');

function configurationDistante(prompt = PROMPT, version = 'agtvrsn_test1'): Json {
  return {
    agent_id: 'agent_fictif',
    version_id: version,
    name: 'Assistante de test',
    conversation_config: {
      agent: {
        first_message: '',
        language: 'fr',
        prompt: { prompt, llm: 'modele-test', temperature: 0.7, tools: [{ type: 'client', name: 'proposer_creneaux' }] },
      },
      tts: { voice_id: 'voixfictive0001', speed: 1 },
      turn: { turn_eagerness: 'normal', soft_timeout_config: { message: 'Hmm…', timeout_seconds: 1.2 } },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

/** Un faux ElevenLabs : garde la configuration envoyée et change de version à chaque modification. */
function fauxClient(): ClientAgent & { etat: Json; modifications: number; panne: boolean } {
  const faux = {
    etat: configurationDistante(),
    modifications: 0,
    panne: false,
    async lire() {
      if (faux.panne) throw new Error('réseau coupé');
      return structuredClone(faux.etat);
    },
    async modifier(config: Json) {
      faux.modifications++;
      faux.etat = { ...structuredClone(faux.etat), ...structuredClone(config), version_id: `agtvrsn_test${faux.modifications + 1}` };
    },
    async creer() {
      return 'agent_fictif';
    },
  };
  return faux;
}

let dossier: string;
let client: ReturnType<typeof fauxClient>;
let o: { dossier: string; client: ClientAgent };

beforeEach(async () => {
  dossier = await mkdtemp(join(tmpdir(), 'agent-web-'));
  client = fauxClient();
  o = { dossier, client };
  await enregistrerDistante(dossier, await client.lire());
});
afterEach(async () => {
  await rm(dossier, { recursive: true, force: true });
});

const empreinte = async () => (await lireConfigurationAssistante({ ...o, distante: false })).synchro.empreinteLocale;
const promptLocal = () => readFile(join(dossier, 'prompt.md'), 'utf8');

describe('lireConfigurationAssistante', () => {
  it('rend le prompt, les réglages modifiables, ce qui reste en lecture seule et la synchronisation', async () => {
    const vue = await lireConfigurationAssistante(o);

    expect(vue.prompt).toBe(PROMPT);
    expect(vue.reglages).toEqual({
      llm: 'modele-test',
      temperature: 0.7,
      voix: { voiceId: 'voixfictive0001', vitesse: 1 },
      tour: { empressement: 'normal' },
      relances: { premiere: 'Hmm…', delaiS: 1.2 },
      libelleTableauDeBord: 'Assistante de test',
    });
    expect(vue.lectureSeule).toMatchObject({ langue: 'fr', outils: [{ nom: 'proposer_creneaux', type: 'client' }], authentification: true, firstMessage: '' });
    expect(vue.variablesDisponibles).toEqual(VARIABLES_DE_L_APPEL);
    expect(vue.synchro).toMatchObject({
      distante: { versionId: 'agtvrsn_test1' },
      modificationsLocalesNonPoussees: false,
      distanteModifieeDepuisLeVerrou: false,
    });
  });

  it('dit pourquoi ElevenLabs n’est pas lu, sans échouer', async () => {
    client.panne = true;
    expect((await lireConfigurationAssistante(o)).synchro).toMatchObject({ distante: null, erreurDistante: expect.stringContaining('réseau coupé') });
    expect((await lireConfigurationAssistante({ dossier, client: null })).synchro.distante).toBeNull();
  });
});

describe('modifierPromptAssistante', () => {
  it('applique les remplacements exacts et rend la nouvelle empreinte', async () => {
    const r = await modifierPromptAssistante([{ avant: 'une assistante de test', apres: 'une assistante patiente' }], await empreinte(), o);

    expect(r).toMatchObject({ ok: true, lignesModifiees: 2 });
    expect(await promptLocal()).toBe(PROMPT.replace('une assistante de test', 'une assistante patiente'));
    expect(r.ok && r.empreinteLocale).toBe(await empreinte());
    expect(client.modifications).toBe(0);
  });

  it('refuse sur une empreinte périmée, sans rien écrire', async () => {
    const connue = await empreinte();
    await writeFile(join(dossier, 'prompt.md'), `${PROMPT}\nAjout d’une autre session.`);

    expect(await modifierPromptAssistante([{ avant: 'Refus ferme', apres: 'Refus' }], connue, o)).toMatchObject({ ok: false });
  });

  it('refuse un prompt qui perdrait une variable, gagnerait une variable inconnue ou sa section Règles', async () => {
    const connue = await empreinte();
    for (const remplacement of [
      { avant: '{{assistante_nom}}', apres: 'Mina' },
      { avant: 'une assistante de test', apres: '{{variable_inventee}}' },
      { avant: '# Règles', apres: '# Consignes' },
    ]) {
      expect(await modifierPromptAssistante([remplacement], connue, o)).toMatchObject({ ok: false });
    }
    expect(await promptLocal()).toBe(PROMPT);
  });

  it('refuse d’écrire sur une configuration ElevenLabs modifiée ailleurs, écrit avec un avertissement si elle ne répond pas', async () => {
    const connue = await empreinte();
    client.etat = { ...client.etat, version_id: 'agtvrsn_tableau_de_bord' };
    expect(await modifierPromptAssistante([{ avant: 'une assistante de test', apres: 'une assistante' }], connue, o)).toMatchObject({
      ok: false,
      raison: expect.stringContaining('rapatrier_assistante'),
    });

    client.panne = true;
    expect(await modifierPromptAssistante([{ avant: 'une assistante de test', apres: 'une assistante' }], connue, o)).toMatchObject({
      ok: true,
      avertissement: expect.stringContaining('réseau coupé'),
    });
  });
});

describe('modifierReglagesAssistante', () => {
  it('écrit les réglages de la liste blanche aux bons chemins', async () => {
    const r = await modifierReglagesAssistante({ temperature: 0.5, voix: { vitesse: 1.1 }, relances: { suivantes: ['Alors…'] } }, await empreinte(), o);

    expect(r).toMatchObject({ ok: true, champs: ['temperature', 'voix.vitesse', 'relances.suivantes'] });
    const config = JSON.parse(await readFile(join(dossier, 'mina.config.json'), 'utf8'));
    expect(config.conversation_config.agent.prompt.temperature).toBe(0.5);
    expect(config.conversation_config.tts.speed).toBe(1.1);
    expect(config.conversation_config.turn.soft_timeout_config).toEqual({ message: 'Hmm…', timeout_seconds: 1.2, additional_soft_timeout_messages: ['Alors…'] });
  });

  it('refuse une valeur hors bornes, un champ hors liste ou un réglage vide', async () => {
    const connue = await empreinte();
    for (const patch of [{ temperature: 2 }, { dureeMaxS: 400 }, { voix: { vitesse: 2 } }, { tour: { empressement: 'presse' } }, { first_message: 'Bonjour' }, {}]) {
      expect(await modifierReglagesAssistante(patch as never, connue, o)).toMatchObject({ ok: false });
    }
  });
});

describe('poussée', () => {
  it('rien à pousser quand agent/ est identique à ElevenLabs', async () => {
    expect(await preparerPousseeAssistante(o)).toEqual({ ok: true, rien: true });
  });

  it('pousse après accord, consigne la version remplacée et la nouvelle, et remet le verrou à jour', async () => {
    await modifierPromptAssistante([{ avant: 'une assistante de test', apres: 'une assistante patiente' }], await empreinte(), o);
    await modifierReglagesAssistante({ temperature: 0.5 }, await empreinte(), o);

    const preparation = await preparerPousseeAssistante(o);
    expect(preparation).toMatchObject({ ok: true, rien: false, horsListe: [], tropLong: false, campagneEnCours: false });
    if (!preparation.ok || preparation.rien) throw new Error('préparation attendue');
    expect(preparation.diff).toContain('− Tu es {{assistante_nom}}, une assistante de test.');
    expect(preparation.diff).toContain('température : 0,7 → 0,5');

    const r = await pousserAssistante({ ...o, attendu: preparation.attendu, origine: 'mcp' });

    expect(r).toMatchObject({ ok: true, versionAvant: 'agtvrsn_test1', versionApres: 'agtvrsn_test2' });
    const consignees = await db.select().from(versionsAssistante);
    expect(consignees.map((v) => [v.versionId, v.origine]).sort()).toEqual([
      ['agtvrsn_test1', 'cli'],
      ['agtvrsn_test2', 'mcp'],
    ]);
    expect(consignees.find((v) => v.versionId === 'agtvrsn_test2')?.prompt).toContain('une assistante patiente');
    expect((await lireConfigurationAssistante(o)).synchro).toMatchObject({ modificationsLocalesNonPoussees: false, distanteModifieeDepuisLeVerrou: false });
  });

  it('refuse si agent/ a bougé depuis la question', async () => {
    await modifierReglagesAssistante({ temperature: 0.5 }, await empreinte(), o);
    const preparation = await preparerPousseeAssistante(o);
    if (!preparation.ok || preparation.rien) throw new Error('préparation attendue');
    await modifierReglagesAssistante({ temperature: 0.4 }, await empreinte(), o);

    expect(await pousserAssistante({ ...o, attendu: preparation.attendu, origine: 'mcp' })).toMatchObject({ ok: false });
    expect(client.modifications).toBe(0);
  });

  it('par le MCP, refuse les champs hors liste blanche et les différences trop longues', async () => {
    const config = JSON.parse(await readFile(join(dossier, 'mina.config.json'), 'utf8'));
    config.conversation_config.agent.prompt.tools.push({ type: 'client', name: 'outil_glisse' });
    await writeFile(join(dossier, 'mina.config.json'), JSON.stringify(config));
    let preparation = await preparerPousseeAssistante(o);
    if (!preparation.ok || preparation.rien) throw new Error('préparation attendue');
    expect(preparation.horsListe).toEqual(['conversation_config.agent.prompt.tools']);
    expect(await pousserAssistante({ ...o, attendu: preparation.attendu, origine: 'mcp' })).toMatchObject({
      ok: false,
      raison: expect.stringContaining('pnpm agent push'),
    });

    await enregistrerDistante(dossier, await client.lire());
    // Deux passages de moins de 4 000 caractères chacun, pour une différence qui en dépasse 4 000.
    const long = Array.from({ length: 45 }, (_, i) => `Ligne ajoutée numéro ${i} pour allonger la différence au-delà du relisible.`).join('\n');
    const ecrit = await modifierPromptAssistante(
      [
        { avant: '# Règles', apres: `${long}\n\n# Règles` },
        { avant: '# Ce que tu sais', apres: `${long}\n\n# Ce que tu sais` },
      ],
      await empreinte(),
      o,
    );
    expect(ecrit.ok).toBe(true);
    preparation = await preparerPousseeAssistante(o);
    if (!preparation.ok || preparation.rien) throw new Error('préparation attendue');
    expect(preparation.tropLong).toBe(true);
    expect(await pousserAssistante({ ...o, attendu: preparation.attendu, origine: 'mcp' })).toMatchObject({ ok: false });
    expect(client.modifications).toBe(0);
  });

  it('refuse de pousser sur une configuration ElevenLabs modifiée ailleurs', async () => {
    client.etat = { ...client.etat, version_id: 'agtvrsn_tableau_de_bord' };
    expect(await preparerPousseeAssistante(o)).toMatchObject({ ok: false, raison: expect.stringContaining('rapatrier_assistante') });
  });

  it('refuse sans ElevenLabs configuré', async () => {
    expect(await preparerPousseeAssistante({ dossier, client: null })).toMatchObject({ ok: false });
  });
});

describe('rapatriement, historique et retour arrière', () => {
  it('rapatrie une modification du tableau de bord et la consigne comme distante', async () => {
    client.etat = configurationDistante(PROMPT.replace('une assistante de test', 'une assistante du tableau de bord'), 'agtvrsn_tdb');

    expect(await rapatrierAssistante(o)).toMatchObject({ ok: true, versionId: 'agtvrsn_tdb' });
    expect(await promptLocal()).toContain('une assistante du tableau de bord');
    expect(await db.select({ v: versionsAssistante.versionId, o: versionsAssistante.origine }).from(versionsAssistante)).toEqual([
      { v: 'agtvrsn_tdb', o: 'distante' },
    ]);
  });

  it('ne rapatrie jamais par-dessus des modifications locales', async () => {
    await modifierReglagesAssistante({ temperature: 0.5 }, await empreinte(), o);
    expect(await rapatrierAssistante(o)).toMatchObject({ ok: false, raison: expect.stringContaining('git stash') });
  });

  it('liste les versions avec leurs appels réels, et restaure une version à repousser', async () => {
    await modifierPromptAssistante([{ avant: 'une assistante de test', apres: 'une assistante patiente' }], await empreinte(), o);
    const preparation = await preparerPousseeAssistante(o);
    if (!preparation.ok || preparation.rien) throw new Error('préparation attendue');
    await pousserAssistante({ ...o, attendu: preparation.attendu, origine: 'mcp' });
    const e = await entrepriseDeTest();
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const appel = { entrepriseId: e.id, prospectId: 'fictif', versionScriptId, numero: '+33639980001', versionAgent: 'agtvrsn_test1' };
    await db.insert(appels).values([
      { ...appel, ligne: 'bluetooth' },
      { ...appel, ligne: 'simulation' },
    ]);

    const historique = await historiqueAssistante(o);
    expect(historique.map((h) => [h.versionId, h.appels, h.estLeVerrou])).toEqual(
      expect.arrayContaining([
        ['agtvrsn_test1', 1, false],
        ['agtvrsn_test2', 0, true],
      ]),
    );
    expect((await versionAssistante('agtvrsn_test1', o))?.differenceAvecLocal).toContain('+ Tu es {{assistante_nom}}, une assistante patiente.');

    expect(await restaurerAssistante('agtvrsn_test1', o)).toMatchObject({ ok: true });
    expect(await promptLocal()).toBe(PROMPT);
    expect(await restaurerAssistante('agtvrsn_test2', o)).toMatchObject({ ok: false, raison: expect.stringContaining('non poussées') });
    expect(await restaurerAssistante('agtvrsn_inconnue', o)).toMatchObject({ ok: false });
  });
});
