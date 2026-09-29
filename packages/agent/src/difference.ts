import { CHEMIN_PROMPT, extraireGere, type Json, avecPrompt } from './configuration.ts';

/**
 * Ce qui change d'une configuration à l'autre, rédigé pour être relu par l'opérateur avant une poussée :
 * les lignes du prompt retirées (−) puis ajoutées (+), avec une ligne de contexte, puis les réglages modifiés.
 */

export interface Difference {
  vide: boolean;
  texte: string;
  /** Chaque champ géré qui change, feuille par feuille (un tableau compte pour une feuille), prompt compris. */
  champs: { chemin: string; avant: unknown; apres: unknown }[];
}

/** Libellés des réglages que l'opérateur règle le plus souvent ; les autres chemins s'affichent tels quels. */
const LIBELLES: Record<string, string> = {
  name: 'libellé du tableau de bord',
  'conversation_config.agent.prompt.llm': 'modèle de langage',
  'conversation_config.agent.prompt.temperature': 'température',
  'conversation_config.tts.voice_id': 'voix',
  'conversation_config.tts.model_id': 'modèle de voix',
  'conversation_config.tts.stability': 'stabilité de la voix',
  'conversation_config.tts.similarity_boost': 'similarité de la voix',
  'conversation_config.tts.speed': 'vitesse de la voix',
  'conversation_config.turn.turn_eagerness': 'empressement du tour de parole',
  'conversation_config.turn.turn_timeout': 'délai de silence avant relance (s)',
  'conversation_config.turn.speculative_turn': 'tour spéculatif',
  'conversation_config.turn.interruption_ignore_terms': 'mots qui n’interrompent pas',
  'conversation_config.turn.soft_timeout_config.message': 'première relance de silence',
  'conversation_config.turn.soft_timeout_config.additional_soft_timeout_messages': 'relances de silence suivantes',
  'conversation_config.turn.soft_timeout_config.timeout_seconds': 'délai des relances de silence (s)',
  'conversation_config.conversation.max_duration_seconds': 'durée maximale d’un appel (s)',
};

function feuilles(objet: unknown, prefixe = '', sortie = new Map<string, unknown>()): Map<string, unknown> {
  if (objet && typeof objet === 'object' && !Array.isArray(objet)) {
    for (const [cle, valeur] of Object.entries(objet as Json)) feuilles(valeur, prefixe ? `${prefixe}.${cle}` : cle, sortie);
  } else if (prefixe) {
    sortie.set(prefixe, objet);
  }
  return sortie;
}

function valeurLisible(valeur: unknown): string {
  if (valeur === undefined) return '(absent)';
  if (typeof valeur === 'number') return String(valeur).replace('.', ',');
  if (typeof valeur === 'string') return `« ${valeur} »`;
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  return JSON.stringify(valeur);
}

type Operation = { type: ' ' | '-' | '+'; ligne: string };

/** Différence ligne à ligne (plus longue sous-suite commune) : les retraits d'un bloc avant ses ajouts. */
function differenceLignes(avant: string[], apres: string[]): Operation[] {
  const n = avant.length;
  const m = apres.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = avant[i] === apres[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const operations: Operation[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && avant[i] === apres[j]) {
      operations.push({ type: ' ', ligne: avant[i]! });
      i++;
      j++;
      continue;
    }
    // Un bloc de changements : tous ses retraits, puis tous ses ajouts.
    const retraits: string[] = [];
    const ajouts: string[] = [];
    while ((i < n || j < m) && !(i < n && j < m && avant[i] === apres[j])) {
      if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) retraits.push(avant[i++]!);
      else ajouts.push(apres[j++]!);
    }
    operations.push(...retraits.map((ligne) => ({ type: '-' as const, ligne })), ...ajouts.map((ligne) => ({ type: '+' as const, ligne })));
  }
  return operations;
}

/** Les opérations regroupées en blocs, avec `contexte` lignes inchangées autour de chaque changement. */
function blocs(operations: Operation[], contexte = 1): string[] {
  const garder = new Set<number>();
  operations.forEach((o, i) => {
    if (o.type === ' ') return;
    for (let k = Math.max(0, i - contexte); k <= Math.min(operations.length - 1, i + contexte); k++) garder.add(k);
  });
  const lignes: string[] = [];
  let precedent = -1;
  for (const i of [...garder].sort((a, b) => a - b)) {
    if (precedent >= 0 && i > precedent + 1) lignes.push('  …');
    const o = operations[i]!;
    lignes.push(`${o.type === '-' ? '−' : o.type === '+' ? '+' : ' '} ${o.ligne}`);
    precedent = i;
  }
  return lignes;
}

export function difference(
  avant: { prompt: string; configuration: Json },
  apres: { prompt: string; configuration: Json },
): Difference {
  const a = feuilles(extraireGere(avecPrompt(avant.configuration, avant.prompt)));
  const b = feuilles(extraireGere(avecPrompt(apres.configuration, apres.prompt)));
  const chemins = [...new Set([...a.keys(), ...b.keys()])].sort();
  const champs = chemins
    .filter((c) => JSON.stringify(a.get(c)) !== JSON.stringify(b.get(c)))
    .map((chemin) => ({ chemin, avant: a.get(chemin), apres: b.get(chemin) }));

  const sections: string[] = [];
  if (champs.some((c) => c.chemin === CHEMIN_PROMPT)) {
    sections.push(['Prompt :', ...blocs(differenceLignes(avant.prompt.split('\n'), apres.prompt.split('\n')))].join('\n'));
  }
  const reglages = champs.filter((c) => c.chemin !== CHEMIN_PROMPT);
  if (reglages.length) {
    sections.push(
      [
        'Réglages :',
        ...reglages.map((c) => `  ${LIBELLES[c.chemin] ?? c.chemin} : ${valeurLisible(c.avant)} → ${valeurLisible(c.apres)}`),
      ].join('\n'),
    );
  }
  return { vide: champs.length === 0, texte: sections.join('\n\n'), champs };
}
