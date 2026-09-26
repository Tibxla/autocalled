/**
 * Synchronise la configuration de Mina entre le dépôt et ElevenLabs.
 *
 *   node --env-file=.env scripts/agent.ts create   crée l'agent et affiche son identifiant
 *   node --env-file=.env scripts/agent.ts pull     rapatrie la configuration distante dans agent/
 *   node --env-file=.env scripts/agent.ts push     envoie agent/ vers ElevenLabs
 *   node --env-file=.env scripts/agent.ts status   dit si le dépôt et ElevenLabs divergent
 *
 * On règle Mina dans le tableau de bord, puis on fait `pull` et on commite. `push` refuse d'écraser
 * une configuration distante modifiée depuis le dernier `pull` ou `push` : agent/remote.lock.json
 * garde l'empreinte de la dernière configuration distante connue.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://api.elevenlabs.io/v1/convai/agents';
const DOSSIER = new URL('../agent/', import.meta.url);
const FICHIER_CONFIG = new URL('mina.config.json', DOSSIER);
const FICHIER_PROMPT = new URL('prompt.md', DOSSIER);
const FICHIER_VERROU = new URL('remote.lock.json', DOSSIER);

type Json = Record<string, unknown>;

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`variable d'environnement manquante : ${nom}`);
  return valeur;
}

async function api(chemin: string, init: RequestInit = {}): Promise<Json> {
  const reponse = await fetch(`${API}${chemin}`, {
    ...init,
    headers: { 'xi-api-key': exiger('ELEVENLABS_API_KEY'), 'content-type': 'application/json' },
  });
  if (!reponse.ok) throw new Error(`ElevenLabs ${reponse.status} : ${await reponse.text()}`);
  return (await reponse.json()) as Json;
}

function lire(objet: unknown, chemin: string): unknown {
  return chemin.split('.').reduce<unknown>((o, cle) => (o as Json | undefined)?.[cle], objet);
}

function ecrire(objet: Json, chemin: string, valeur: unknown): void {
  const cles = chemin.split('.');
  const derniere = cles.pop() as string;
  let courant = objet;
  for (const cle of cles) courant = (courant[cle] ??= {}) as Json;
  courant[derniere] = valeur;
}

/** Les seuls champs que le dépôt gère ; le reste de la configuration reste à ElevenLabs. */
const CHAMPS_GERES = [
  'name',
  'conversation_config.agent.first_message',
  'conversation_config.agent.language',
  'conversation_config.agent.prompt.prompt',
  'conversation_config.agent.prompt.llm',
  'conversation_config.agent.prompt.temperature',
  'conversation_config.agent.prompt.built_in_tools',
  'conversation_config.agent.prompt.tools',
  'platform_settings.auth.enable_auth',
  'conversation_config.agent.dynamic_variables.dynamic_variable_placeholders',
  'conversation_config.tts.voice_id',
  'conversation_config.tts.model_id',
  'conversation_config.tts.stability',
  'conversation_config.tts.similarity_boost',
  'conversation_config.tts.speed',
  'conversation_config.turn.turn_eagerness',
  'conversation_config.turn.turn_timeout',
  'conversation_config.conversation.max_duration_seconds',
];

/** ElevenLabs renvoie chaque outil désactivé sous forme de `null` : on les retire pour garder un fichier lisible. */
function sansNull(valeur: unknown): unknown {
  if (valeur === null) return undefined;
  if (Array.isArray(valeur)) return valeur.map(sansNull);
  if (typeof valeur === 'object') {
    return Object.fromEntries(
      Object.entries(valeur as Json)
        .map(([cle, v]) => [cle, sansNull(v)] as const)
        .filter(([, v]) => v !== undefined),
    );
  }
  return valeur;
}

function extraireGere(config: Json): Json {
  const gere: Json = {};
  for (const chemin of CHAMPS_GERES) {
    const valeur = sansNull(lire(config, chemin));
    if (valeur !== undefined) ecrire(gere, chemin, valeur);
  }
  return gere;
}

function trier(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(trier);
  if (valeur && typeof valeur === 'object') {
    return Object.fromEntries(Object.keys(valeur).sort().map((cle) => [cle, trier((valeur as Json)[cle])]));
  }
  return valeur;
}

function empreinte(config: Json): string {
  return createHash('sha256').update(JSON.stringify(trier(extraireGere(config)))).digest('hex');
}

async function configLocale(): Promise<Json> {
  const config = JSON.parse(await readFile(FICHIER_CONFIG, 'utf8')) as Json;
  ecrire(config, 'conversation_config.agent.prompt.prompt', await readFile(FICHIER_PROMPT, 'utf8'));
  return config;
}

async function verrou(): Promise<{ empreinte: string } | null> {
  try {
    return JSON.parse(await readFile(FICHIER_VERROU, 'utf8')) as { empreinte: string };
  } catch {
    return null;
  }
}

async function enregistrerLocal(distante: Json): Promise<void> {
  const gere = extraireGere(distante);
  const prompt = lire(gere, 'conversation_config.agent.prompt.prompt');
  ecrire(gere, 'conversation_config.agent.prompt.prompt', undefined);
  const sansPrompt = JSON.parse(JSON.stringify(gere)) as Json;
  await writeFile(FICHIER_CONFIG, `${JSON.stringify(sansPrompt, null, 2)}\n`);
  await writeFile(FICHIER_PROMPT, typeof prompt === 'string' ? prompt : '');
  await writeFile(
    FICHIER_VERROU,
    `${JSON.stringify({ versionId: distante.version_id ?? null, empreinte: empreinte(distante) }, null, 2)}\n`,
  );
}

async function distante(): Promise<Json> {
  return api(`/${exiger('ELEVENLABS_AGENT_ID')}`);
}

const commandes: Record<string, () => Promise<void>> = {
  async create() {
    if (process.env.ELEVENLABS_AGENT_ID) throw new Error('ELEVENLABS_AGENT_ID est déjà défini : utilise push');
    const { agent_id } = await api('/create', { method: 'POST', body: JSON.stringify(await configLocale()) });
    process.env.ELEVENLABS_AGENT_ID = String(agent_id);
    await enregistrerLocal(await distante());
    console.log(`Agent créé. Ajoute dans .env : ELEVENLABS_AGENT_ID=${agent_id}`);
  },

  async pull() {
    await enregistrerLocal(await distante());
    console.log('Configuration distante rapatriée dans agent/. Relis le diff, puis commite.');
  },

  async push() {
    const connu = await verrou();
    const avant = await distante();
    if (connu && connu.empreinte !== empreinte(avant)) {
      throw new Error('La configuration distante a changé depuis le dernier pull : lance pull et relis le diff avant de pousser.');
    }
    await api(`/${exiger('ELEVENLABS_AGENT_ID')}`, { method: 'PATCH', body: JSON.stringify(await configLocale()) });
    await enregistrerLocal(await distante());
    console.log('Configuration envoyée.');
  },

  /**
   * Déclare à Mina les outils d'agenda servis par apps/outils et exposés par Tailscale Funnel. Le secret
   * partagé est rangé dans les secrets de l'espace ElevenLabs : la configuration (et donc le dépôt)
   * ne contient que sa référence.
   */
  async outils() {
    const url = exiger('URL_PUBLIQUE_OUTILS');
    const reponse = await fetch('https://api.elevenlabs.io/v1/convai/secrets', {
      method: 'POST',
      headers: { 'xi-api-key': exiger('ELEVENLABS_API_KEY'), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'new', name: `autocalled_outils_${Date.now()}`, value: `Bearer ${exiger('OUTILS_WEBHOOK_SECRET')}` }),
    });
    if (!reponse.ok) throw new Error(`secret ElevenLabs ${reponse.status} : ${await reponse.text()}`);
    const { secret_id } = (await reponse.json()) as { secret_id: string };
    const entete = { Authorization: { secret_id } };
    const conversation = { type: 'string', dynamic_variable: 'system__conversation_id' };
    const outil = (name: string, description: string, chemin: string, proprietes: Json, requis: string[]) => ({
      type: 'webhook',
      name,
      description,
      response_timeout_secs: 20,
      api_schema: {
        url: `${url}${chemin}`,
        method: 'POST',
        request_headers: entete,
        request_body_schema: { type: 'object', properties: proprietes, required: requis },
      },
    });
    const config = await configLocale();
    const actuels = (lire(config, 'conversation_config.agent.prompt.tools') as Json[] | undefined) ?? [];
    const autres = actuels.filter((t) => t.name !== 'proposer_creneaux' && t.name !== 'reserver_creneau');
    ecrire(config, 'conversation_config.agent.prompt.tools', [
      ...autres,
      outil('proposer_creneaux', 'Renvoie quelques créneaux libres pour un premier rendez-vous, selon l’agenda réel.', '/outils/proposer-creneaux', { conversation_id: conversation }, ['conversation_id']),
      outil(
        'reserver_creneau',
        'Réserve le créneau choisi par le prospect. À appeler seulement après son accord explicite.',
        '/outils/reserver-creneau',
        { conversation_id: conversation, debut: { type: 'string', description: 'La valeur debut exacte du créneau choisi, telle que renvoyée par proposer_creneaux.' } },
        ['conversation_id', 'debut'],
      ),
    ]);
    const connu = await verrou();
    if (connu && connu.empreinte !== empreinte(await distante())) throw new Error('La configuration distante a changé : lance pull avant.');
    await api(`/${exiger('ELEVENLABS_AGENT_ID')}`, { method: 'PATCH', body: JSON.stringify(config) });
    await enregistrerLocal(await distante());
    console.log('Outils d’agenda déclarés. Relis agent/mina.config.json : il ne doit contenir que la référence du secret.');
  },

  async status() {
    const connu = await verrou();
    const actuelle = await distante();
    const distanteModifiee = connu?.empreinte !== empreinte(actuelle);
    const localeModifiee = empreinte(await configLocale()) !== empreinte(actuelle);
    console.log(`distante modifiée depuis le dernier pull : ${distanteModifiee ? 'oui' : 'non'}`);
    console.log(`dépôt différent de la configuration distante : ${localeModifiee ? 'oui' : 'non'}`);
  },
};

const commande = commandes[process.argv[2] ?? ''];
if (!commande) {
  console.error('usage : scripts/agent.ts create | pull | push | status');
  process.exit(1);
}
await commande();
