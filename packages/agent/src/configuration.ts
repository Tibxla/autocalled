import { createHash } from 'node:crypto';

/**
 * La part de la configuration ElevenLabs de l'assistante que le dépôt gère (`agent/`), et son empreinte.
 * Le reste de la configuration reste à ElevenLabs.
 */

export type Json = Record<string, unknown>;

/** Chemin du prompt dans la configuration ElevenLabs ; dans le dépôt, il vit à part, dans `agent/prompt.md`. */
export const CHEMIN_PROMPT = 'conversation_config.agent.prompt.prompt';

/** Les seuls champs que le dépôt gère. */
export const CHAMPS_GERES: readonly string[] = [
  'name',
  'conversation_config.agent.first_message',
  'conversation_config.agent.language',
  CHEMIN_PROMPT,
  'conversation_config.agent.prompt.llm',
  'conversation_config.agent.prompt.temperature',
  'conversation_config.agent.prompt.built_in_tools',
  'conversation_config.agent.prompt.tools',
  'platform_settings.auth.enable_auth',
  'platform_settings.overrides.conversation_config_override.asr.keywords',
  // Le pont surcharge le premier message quand le prospect se tait au décroché : sans cette permission, un agent
  // recréé depuis le dépôt refuserait la surcharge et l'ouverture casserait.
  'platform_settings.overrides.conversation_config_override.agent.first_message',
  'platform_settings.overrides.conversation_config_override.conversation.text_only',
  'conversation_config.agent.dynamic_variables.dynamic_variable_placeholders',
  'conversation_config.tts.voice_id',
  'conversation_config.tts.model_id',
  'conversation_config.tts.stability',
  'conversation_config.tts.similarity_boost',
  'conversation_config.tts.speed',
  'conversation_config.turn.turn_eagerness',
  'conversation_config.turn.turn_timeout',
  'conversation_config.turn.speculative_turn',
  'conversation_config.turn.interruption_ignore_terms',
  'conversation_config.turn.interruption_ignore_term_languages',
  'conversation_config.turn.merge_with_default_ignore_terms',
  'conversation_config.turn.soft_timeout_config',
  'conversation_config.conversation.max_duration_seconds',
];

export function lireChemin(objet: unknown, chemin: string): unknown {
  return chemin.split('.').reduce<unknown>((o, cle) => (o && typeof o === 'object' ? (o as Json)[cle] : undefined), objet);
}

export function ecrireChemin(objet: Json, chemin: string, valeur: unknown): void {
  const cles = chemin.split('.');
  const derniere = cles.pop() as string;
  let courant = objet;
  for (const cle of cles) {
    const suivant = courant[cle];
    if (!suivant || typeof suivant !== 'object' || Array.isArray(suivant)) courant[cle] = {};
    courant = courant[cle] as Json;
  }
  if (valeur === undefined) delete courant[derniere];
  else courant[derniere] = valeur;
}

export function copie<T>(valeur: T): T {
  return structuredClone(valeur);
}

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

export function extraireGere(config: Json): Json {
  const gere: Json = {};
  for (const chemin of CHAMPS_GERES) {
    const valeur = sansNull(lireChemin(config, chemin));
    if (valeur !== undefined) ecrireChemin(gere, chemin, valeur);
  }
  return gere;
}

function trier(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(trier);
  if (valeur && typeof valeur === 'object') {
    return Object.fromEntries(
      Object.keys(valeur)
        .sort()
        .map((cle) => [cle, trier((valeur as Json)[cle])]),
    );
  }
  return valeur;
}

/** Empreinte des champs gérés, prompt compris : indépendante de l'ordre des clés et des champs non gérés. */
export function empreinte(config: Json): string {
  return createHash('sha256').update(JSON.stringify(trier(extraireGere(config)))).digest('hex');
}

/** La configuration complète telle qu'ElevenLabs la reçoit : celle du dépôt, prompt remis à sa place. */
export function avecPrompt(configuration: Json, prompt: string): Json {
  const complete = copie(configuration);
  ecrireChemin(complete, CHEMIN_PROMPT, prompt);
  return complete;
}

/** Sépare le prompt du reste : l'inverse d'`avecPrompt`, sur les champs gérés seulement. */
export function separerPrompt(config: Json): { prompt: string; configuration: Json } {
  const gere = extraireGere(config);
  const prompt = lireChemin(gere, CHEMIN_PROMPT);
  ecrireChemin(gere, CHEMIN_PROMPT, undefined);
  return { prompt: typeof prompt === 'string' ? prompt : '', configuration: gere };
}
