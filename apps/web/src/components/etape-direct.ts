/**
 * L'étape du plan où l'assistante se trouve pendant un appel, signalée par l'outil client `etape_script` : le pont
 * la relaie dans le fil (`{ type: 'etape', numero, t }`), la ligne navigateur la reçoit directement. Affichage
 * seulement : l'étape atteinte du bilan reste l'autorité (ADR 0005). Un pont ou un agent ancien n'en envoient pas,
 * et la bande n'affiche alors rien.
 */

/** Le plus grand nombre d'étapes d'un script (`MAX_ETAPES` de lib/schemas.ts, `ETAPE_MAX` du pont). */
export const ETAPE_MAX = 10;
const LIBELLE_MAX = 40;

/** Un numéro d'étape lisible (entier de 1 à ETAPE_MAX, en nombre ou en texte), sinon null. */
export function numeroEtape(valeur: unknown): number | null {
  const n = typeof valeur === 'string' && /^\s*\d+\s*$/.test(valeur) ? Number(valeur) : valeur;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= ETAPE_MAX ? n : null;
}

/** Le libellé court d'une étape : son intention jusqu'au premier « : », sinon coupée à 40 caractères sur un mot. */
export function libelleEtape(intention: string): string {
  const propre = intention.trim().replace(/\s+/g, ' ');
  const deuxPoints = propre.indexOf(':');
  const tete = deuxPoints > 0 ? propre.slice(0, deuxPoints).trim() : propre;
  if (tete.length <= LIBELLE_MAX) return tete;
  const coupe = tete.slice(0, LIBELLE_MAX + 1).lastIndexOf(' ');
  return `${tete.slice(0, coupe > 0 ? coupe : LIBELLE_MAX).replace(/[\s,;.]+$/, '')}…`;
}

export interface EtapeAffichee {
  numero: number;
  /** Nombre d'étapes de la version de l'appel, null si inconnu. */
  total: number | null;
  libelle: string | null;
}

/**
 * Ce que la bande affiche pour une étape signalée : « Étape 2/4 · Qualification », ou « Étape 2 » sans les
 * étapes de la version. Un numéro plus grand que le nombre d'étapes connu n'affiche rien.
 */
export function etapeAffichee(numero: number | null | undefined, etapes?: readonly string[] | null): EtapeAffichee | null {
  if (numero == null || numeroEtape(numero) === null) return null;
  if (!etapes || etapes.length === 0) return { numero, total: null, libelle: null };
  if (numero > etapes.length) return null;
  const libelle = libelleEtape(etapes[numero - 1] ?? '');
  return { numero, total: etapes.length, libelle: libelle || null };
}
