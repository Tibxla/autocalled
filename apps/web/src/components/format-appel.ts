import {
  LIBELLES_ISSUES,
  type EntreeCampagne,
  type IssueSysteme,
  type StatutCampagne,
} from '@autocalled/domain';

/**
 * Formats et règles d'affichage d'un appel, partagés par tous les écrans. Fonctions pures (serveur et
 * client) : l'heure est toujours celle de Paris, quel que soit le fuseau de la machine.
 */

export const FUSEAU = 'Europe/Paris';

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: FUSEAU });
const FORMAT_JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: FUSEAU });
const FORMAT_JOUR_SEMAINE = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: FUSEAU });
const FORMAT_CLE = new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: FUSEAU });
const FORMAT_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSEAU });
const FORMAT_LONG_ANNEE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: FUSEAU,
});

function date(d: Date | string): Date {
  return typeof d === 'string' ? new Date(d) : d;
}

function majuscule(texte: string): string {
  return texte.charAt(0).toLocaleUpperCase('fr-FR') + texte.slice(1);
}

/** « 14:32 », heure de Paris. */
export function heure(d: Date | string): string {
  return FORMAT_HEURE.format(date(d));
}

/** « 29/09 14:32 ». */
export function dateCourte(d: Date | string): string {
  return `${FORMAT_JOUR_MOIS.format(date(d))} ${heure(d)}`;
}

/** « mar. 29/09 ». */
export function jourCourt(d: Date | string): string {
  return `${FORMAT_JOUR_SEMAINE.format(date(d))} ${FORMAT_JOUR_MOIS.format(date(d))}`;
}

/** « 2026-09-29 » : le jour de Paris, pour regrouper les appels par journée. */
export function cleJour(d: Date | string): string {
  const parties = FORMAT_CLE.formatToParts(date(d));
  const valeur = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? '';
  return `${valeur('year')}-${valeur('month')}-${valeur('day')}`;
}

/** La veille d'une clé de jour, par le calendrier (et non « moins 24 h », faux les jours de 23 et 25 h). */
function veille(cle: string): string {
  const [a, m, j] = cle.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j - 1)).toISOString().slice(0, 10);
}

/** « Aujourd'hui », « Hier », sinon « Lundi 27 septembre » (avec l'année si ce n'est pas celle en cours). */
export function libelleJour(d: Date | string, maintenant: Date = new Date()): string {
  const cle = cleJour(d);
  const cleAujourdhui = cleJour(maintenant);
  if (cle === cleAujourdhui) return 'Aujourd’hui';
  if (cle === veille(cleAujourdhui)) return 'Hier';
  const memeAnnee = cle.slice(0, 4) === cleAujourdhui.slice(0, 4);
  return majuscule((memeAnnee ? FORMAT_LONG : FORMAT_LONG_ANNEE).format(date(d)));
}

const deux = (n: number) => String(n).padStart(2, '0');

/** Durée d'un appel : « 0:47 », « 12:05 », « 1:02:03 » ; rien quand elle est inconnue ou nulle. */
export function duree(secondes: number | null | undefined): string {
  if (!secondes || secondes <= 0) return '';
  const s = Math.round(secondes);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${deux(m)}:${deux(s % 60)}` : `${m}:${deux(s % 60)}`;
}

/** Chrono d'un appel en cours : « 01:42 », « 1:02:03 ». */
export function chrono(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${deux(m)}:${deux(s % 60)}` : `${deux(m)}:${deux(s % 60)}`;
}

/** Le prénom, c'est-à-dire le premier mot du nom affiché. */
export function prenom(nom: string): string {
  const propre = nom.trim();
  return propre.split(/\s+/)[0] ?? propre;
}

/**
 * Numéro masqué pour l'écran partagé : garde les deux premiers et les deux derniers chiffres d'un numéro
 * déjà formaté par le serveur (« 06 39 98 12 40 » → « 06 •• •• •• 40 »), séparateurs compris.
 */
export function numeroMasque(lisible: string): string {
  const total = (lisible.match(/\d/g) ?? []).length;
  if (total <= 4) return lisible;
  let rang = 0;
  return lisible.replace(/\d/g, (chiffre) => {
    rang += 1;
    return rang <= 2 || rang > total - 2 ? chiffre : '•';
  });
}

export type TonEtat = 'antenne' | 'alerte' | 'encre' | 'encre-2' | 'encre-3';

export interface EtatAppelAffiche {
  cle: 'en-cours' | 'reste-ouvert' | 'analyse' | 'pas-parti' | 'analyse-echec' | 'issue' | 'sans-issue';
  libelle: string;
  ton: TonEtat;
  detail?: string;
}

/** Même mot sur la ligne d'un appel et sur son filtre : l'opérateur retrouve ce qu'il a vu. */
export const LIBELLE_NON_COMPOSE = 'Non composé';

/** Un appel que la ligne n'a pas composé : en échec, sans conversation ouverte. */
export function estNonCompose(a: { statut: string; conversationId?: string | null }): boolean {
  return a.statut === 'echec' && !a.conversationId;
}

/** Au-delà, un appel encore « en cours » sans signe de vie n'est plus présenté comme en cours. */
const DUREE_PLAUSIBLE_MS = 10 * 60 * 1000;

/** Ce qu'une liste affiche de l'état d'un appel, avec son ton. */
export function etatAppel(
  a: {
    statut: string;
    issueSysteme: IssueSysteme | null;
    erreur?: string | null;
    conversationId?: string | null;
    ligne: string;
    debutLe: Date | string;
  },
  o: { vivant?: boolean; libellePerso?: string | null; maintenant?: Date } = {},
): EtatAppelAffiche {
  if (a.statut === 'en-cours') {
    if (o.vivant) return { cle: 'en-cours', libelle: 'En cours', ton: 'antenne' };
    const age = (o.maintenant ?? new Date()).getTime() - date(a.debutLe).getTime();
    if (age < DUREE_PLAUSIBLE_MS && a.ligne === 'simulation') return { cle: 'en-cours', libelle: 'Simulation en cours', ton: 'encre-2' };
    if (age < DUREE_PLAUSIBLE_MS && a.ligne === 'navigateur') return { cle: 'en-cours', libelle: 'En cours (navigateur)', ton: 'encre-2' };
    return { cle: 'reste-ouvert', libelle: 'Resté ouvert', ton: 'encre-3' };
  }
  if (a.statut === 'traitement') return { cle: 'analyse', libelle: 'Analyse…', ton: 'encre-3' };
  if (a.statut === 'echec') {
    const detail = a.erreur ? { detail: a.erreur } : {};
    // Graphite : l'échec se signale par son glyphe (point creux brique), pas par un libellé coloré.
    return estNonCompose(a)
      ? { cle: 'pas-parti', libelle: LIBELLE_NON_COMPOSE, ton: 'encre-2', ...detail }
      : { cle: 'analyse-echec', libelle: 'Analyse en échec', ton: 'encre-2', ...detail };
  }
  const issue = a.issueSysteme;
  if (!issue) return { cle: 'sans-issue', libelle: 'Sans issue', ton: 'encre-3' };
  return {
    cle: 'issue',
    libelle: o.libellePerso || LIBELLES_ISSUES[issue],
    ton: issue === 'rendez-vous-pris' ? 'encre' : 'encre-2',
  };
}

/**
 * Hauteur du trait d'un appel (frise, glyphe d'étape) : elle suit l'étape atteinte rapportée au nombre
 * d'étapes du script ; minimale sans bilan, à l'étape 0 ou sans nombre d'étapes.
 */
export function hauteurTrait(
  etape: number | null | undefined,
  nombre: number | null | undefined,
  o: { min: number; max: number },
): number {
  if (etape == null || !nombre || nombre <= 0 || etape <= 0) return o.min;
  const brute = o.min + ((o.max - o.min) * etape) / nombre;
  return Math.min(o.max, Math.max(o.min, Math.round(brute)));
}

/** La ligne d'un appel, en un mot (listes denses). */
export const LIGNES_COURTES: Record<string, string> = {
  bluetooth: 'téléphone',
  navigateur: 'navigateur',
  simulation: 'simulé',
  twilio: 'Twilio',
};

/** La ligne d'un appel, en toutes lettres (fiches). */
export const LIGNES_LONGUES: Record<string, string> = {
  bluetooth: 'Téléphone passerelle',
  navigateur: 'Ligne navigateur',
  simulation: 'Appel simulé',
  twilio: 'Téléphone (Twilio)',
};

export const STATUTS_CAMPAGNE: Record<StatutCampagne, string> = {
  prete: 'Prête',
  'en-cours': 'En cours',
  'en-pause': 'Suspendue',
  terminee: 'Terminée',
};

/** Comptes d'une campagne : `traites` = appelés + sautés. */
export function comptesCampagne(entrees: readonly EntreeCampagne[]): {
  total: number;
  aAppeler: number;
  enAppel: number;
  appelees: number;
  sautees: number;
  traites: number;
} {
  let aAppeler = 0;
  let enAppel = 0;
  let appelees = 0;
  let sautees = 0;
  for (const e of entrees) {
    if (e.etat === 'a-appeler') aAppeler += 1;
    else if (e.etat === 'en-appel') enAppel += 1;
    else if (e.etat === 'appelee') appelees += 1;
    else sautees += 1;
  }
  return { total: entrees.length, aAppeler, enAppel, appelees, sautees, traites: appelees + sautees };
}
