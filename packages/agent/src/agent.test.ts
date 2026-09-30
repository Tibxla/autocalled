import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientAgent,
  CHEMIN_PROMPT,
  appliquerRemplacements,
  avecPrompt,
  difference,
  empreinte,
  enregistrerDistante,
  etatSynchro,
  extraireGere,
  type Json,
  lireLocal,
  pousser,
  rapatrier,
  validerPrompt,
  variablesDuTexte,
} from './index.ts';

const REGLES = '# Règles\n\n- Refus ferme : tu raccroches poliment.\n';
const PROMPT = `# Personnalité\n\nTu es {{assistante_nom}}, l'assistante de {{entreprise_nom}}.\n${'Tu parles simplement. '.repeat(30)}\n\n${REGLES}`;

function distante(prompt = PROMPT, version = 'agtvrsn_1'): Json {
  return {
    agent_id: 'agent_fictif',
    version_id: version,
    name: 'Assistante',
    conversation_config: {
      agent: { first_message: '', language: 'fr', prompt: { prompt, llm: 'modele-a', temperature: 0.7, tool_ids: ['t1'] } },
      tts: { voice_id: 'voixfictive0001', speed: 1, pronunciation_dictionary_locators: null },
    },
    platform_settings: { auth: { enable_auth: true }, widget: { couleur: 'bleu' } },
  };
}

/** Un faux ElevenLabs : garde la configuration envoyée et change de version à chaque modification. */
function fauxClient(initiale = distante()): ClientAgent & { etat: Json; modifications: number } {
  const faux = {
    etat: structuredClone(initiale),
    modifications: 0,
    async lire() {
      return structuredClone(faux.etat);
    },
    async modifier(config: Json) {
      faux.modifications++;
      faux.etat = { ...structuredClone(faux.etat), ...structuredClone(config), version_id: `agtvrsn_${faux.modifications + 1}` };
    },
    async creer() {
      return 'agent_fictif';
    },
  };
  return faux;
}

let dossier: string;
beforeEach(async () => {
  dossier = await mkdtemp(join(tmpdir(), 'agent-'));
});
afterEach(async () => {
  await rm(dossier, { recursive: true, force: true });
});

describe('champs gérés et empreinte', () => {
  it('ne garde que les champs gérés, sans les null', () => {
    const gere = extraireGere(distante());
    expect(gere).not.toHaveProperty('agent_id');
    expect(gere).not.toHaveProperty('platform_settings.widget');
    expect(gere).not.toHaveProperty('conversation_config.tts.pronunciation_dictionary_locators');
    expect(gere).toHaveProperty(['conversation_config', 'agent', 'prompt', 'prompt'], PROMPT);
  });

  it('ne dépend ni de l’ordre des clés ni des champs non gérés', () => {
    const a = distante();
    const b = { ...distante(), agent_id: 'autre', version_id: 'agtvrsn_9' };
    expect(empreinte(a)).toBe(empreinte(b));
    expect(empreinte(a)).not.toBe(empreinte(distante(`${PROMPT} `)));
  });
});

describe('fichiers de agent/', () => {
  it('sépare le prompt de la configuration et écrit le verrou', async () => {
    const verrou = await enregistrerDistante(dossier, distante());
    const locale = await lireLocal(dossier);

    expect(locale.prompt).toBe(PROMPT);
    expect(locale.configuration).not.toHaveProperty(['conversation_config', 'agent', 'prompt', 'prompt']);
    expect(locale.verrou).toEqual(verrou);
    expect(verrou).toEqual({ versionId: 'agtvrsn_1', empreinte: empreinte(distante()) });
    expect(empreinte(avecPrompt(locale.configuration, locale.prompt))).toBe(verrou.empreinte);
  });

  it('lit un dossier sans verrou', async () => {
    await writeFile(join(dossier, 'mina.config.json'), '{}');
    await writeFile(join(dossier, 'prompt.md'), 'texte');
    expect((await lireLocal(dossier)).verrou).toBeNull();
  });
});

describe('synchronisation', () => {
  it('dit ce qui a bougé, de chaque côté', async () => {
    const client = fauxClient();
    await enregistrerDistante(dossier, await client.lire());
    expect(await etatSynchro(dossier, client)).toMatchObject({ localeModifiee: false, distanteModifiee: false });

    await writeFile(join(dossier, 'prompt.md'), `${PROMPT}\nAjout.`);
    client.etat = { ...client.etat, version_id: 'agtvrsn_autre' };
    expect(await etatSynchro(dossier, client)).toMatchObject({ localeModifiee: true, distanteModifiee: true });
  });

  it('rend la raison plutôt qu’une erreur quand ElevenLabs ne répond pas', async () => {
    await enregistrerDistante(dossier, distante());
    const panne: ClientAgent = {
      lire: async () => {
        throw new Error('réseau coupé');
      },
      modifier: async () => {},
      creer: async () => '',
    };
    expect(await etatSynchro(dossier, panne)).toMatchObject({ distante: null, erreurDistante: 'réseau coupé' });
    expect((await etatSynchro(dossier, null)).distante).toBeNull();
  });

  it('pousse, puis réécrit le verrou sur la nouvelle version', async () => {
    const client = fauxClient();
    await enregistrerDistante(dossier, await client.lire());
    await writeFile(join(dossier, 'prompt.md'), `${PROMPT}\nAjout.`);

    const resultat = await pousser(dossier, client);

    expect(resultat).toMatchObject({ ok: true, versionId: 'agtvrsn_2' });
    expect((await lireLocal(dossier)).verrou?.versionId).toBe('agtvrsn_2');
    expect(await etatSynchro(dossier, client)).toMatchObject({ localeModifiee: false, distanteModifiee: false });
  });

  it('refuse d’écraser une configuration distante modifiée ailleurs', async () => {
    const client = fauxClient();
    await enregistrerDistante(dossier, await client.lire());
    client.etat = { ...client.etat, version_id: 'agtvrsn_tableau_de_bord' };

    expect(await pousser(dossier, client)).toMatchObject({ ok: false });
    expect(client.modifications).toBe(0);
  });

  it('refuse quand ce qui a été relu a changé depuis', async () => {
    const client = fauxClient();
    await enregistrerDistante(dossier, await client.lire());
    const etat = await etatSynchro(dossier, client);
    await writeFile(join(dossier, 'prompt.md'), `${PROMPT}\nAjout glissé après la relecture.`);

    const resultat = await pousser(dossier, client, { empreinteLocale: etat.empreinteLocale, versionIdDistante: 'agtvrsn_1' });

    expect(resultat).toMatchObject({ ok: false });
    expect(client.modifications).toBe(0);
  });

  it('ne rapatrie pas par-dessus des modifications locales, sauf de force', async () => {
    const client = fauxClient();
    await enregistrerDistante(dossier, await client.lire());
    await writeFile(join(dossier, 'prompt.md'), 'modifié');

    expect(await rapatrier(dossier, client)).toMatchObject({ ok: false });
    expect(await readFile(join(dossier, 'prompt.md'), 'utf8')).toBe('modifié');
    expect(await rapatrier(dossier, client, { force: true })).toMatchObject({ ok: true });
    expect(await readFile(join(dossier, 'prompt.md'), 'utf8')).toBe(PROMPT);
  });
});

describe('validation du prompt', () => {
  const attendues = ['assistante_nom', 'entreprise_nom'];

  it('accepte un prompt complet', () => {
    expect(validerPrompt(PROMPT, attendues)).toEqual({ ok: true });
    expect(variablesDuTexte(PROMPT)).toEqual(['assistante_nom', 'entreprise_nom']);
  });

  it('refuse une variable manquante ou inconnue', () => {
    const r = validerPrompt(PROMPT.replace('{{assistante_nom}}', '{{nom_invente}}'), attendues);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erreurs.join('\n')).toMatch(/absentes.*assistante_nom[\s\S]*inconnues.*nom_invente/);
  });

  it('exige une section Règles non vide', () => {
    expect(validerPrompt(PROMPT.replace(REGLES, ''), attendues).ok).toBe(false);
    expect(validerPrompt(PROMPT.replace(REGLES, '# Règles\n\n'), attendues).ok).toBe(false);
  });

  it('borne la longueur', () => {
    expect(validerPrompt('{{assistante_nom}} {{entreprise_nom}}\n# Règles\nx', attendues).ok).toBe(false);
    expect(validerPrompt(PROMPT + 'x'.repeat(20_000), attendues).ok).toBe(false);
  });
});

describe('remplacements exacts', () => {
  it('applique dans l’ordre, sans interpréter les $', () => {
    expect(appliquerRemplacements('un deux trois', [{ avant: 'deux', apres: '$& 2' }, { avant: 'un $& 2', apres: '1' }])).toEqual({
      ok: true,
      texte: '1 trois',
    });
  });

  it('refuse un passage absent, répété ou vide, sans rien appliquer', () => {
    expect(appliquerRemplacements('a b a', [{ avant: 'a', apres: 'x' }])).toMatchObject({ ok: false, raison: expect.stringContaining('2 fois') });
    expect(appliquerRemplacements('a b', [{ avant: 'b', apres: 'c' }, { avant: 'z', apres: '' }])).toMatchObject({ ok: false });
    expect(appliquerRemplacements('a b', [{ avant: '', apres: 'c' }])).toMatchObject({ ok: false });
  });
});

describe('différence à relire', () => {
  it('montre les lignes retirées puis ajoutées, et les réglages en clair', () => {
    const avant = { prompt: 'titre\nligne A\nfin', configuration: extraireGere(distante()) };
    const configuration = structuredClone(avant.configuration);
    (configuration.conversation_config as { agent: { prompt: { temperature: number } } }).agent.prompt.temperature = 0.5;
    const d = difference(avant, { prompt: 'titre\nligne B\nfin', configuration });

    expect(d.vide).toBe(false);
    expect(d.texte).toBe('Prompt :\n  titre\n− ligne A\n+ ligne B\n  fin\n\nRéglages :\n  température : 0,7 → 0,5');
    expect(d.champs.map((c) => c.chemin)).toEqual([CHEMIN_PROMPT, 'conversation_config.agent.prompt.temperature']);
  });

  it('est vide quand rien ne change', () => {
    const c = extraireGere(distante());
    expect(difference({ prompt: PROMPT, configuration: c }, { prompt: PROMPT, configuration: structuredClone(c) })).toEqual({
      vide: true,
      texte: '',
      champs: [],
    });
  });

  it('ignore l’ordre des clés dans un tableau d’objets (une version relue de Postgres, en jsonb)', () => {
    const outils = (ordre: 'a' | 'b') =>
      extraireGere({ conversation_config: { agent: { prompt: { tools: [ordre === 'a' ? { name: 'proposer_creneaux', type: 'client' } : { type: 'client', name: 'proposer_creneaux' }] } } } });
    expect(difference({ prompt: PROMPT, configuration: outils('a') }, { prompt: PROMPT, configuration: outils('b') }).vide).toBe(true);
  });

  it('abrège les longues portions inchangées', () => {
    const lignes = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const apres = [...lignes];
    apres[1] = 'x1';
    apres[8] = 'x8';
    const d = difference({ prompt: lignes.join('\n'), configuration: {} }, { prompt: apres.join('\n'), configuration: {} });
    expect(d.texte).toBe('Prompt :\n  l0\n− l1\n+ x1\n  l2\n  …\n  l7\n− l8\n+ x8\n  l9');
  });
});
