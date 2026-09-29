import { FUSEAU, hauteurTrait, heure } from '../../components/format-appel';
import type { AppelDuJour } from '@/lib/accueil';

/**
 * Géométrie de la frise de la journée, en pourcentages de l'étendue (aucune mesure de largeur en JS).
 * L'axe suit l'heure d'horloge de Paris, comme les heures affichées partout ailleurs : un trait se place à
 * l'heure lue dans le tableau. Fonctions pures, testées.
 */

const PARTIES = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: FUSEAU });

/** Minutes écoulées depuis minuit à l'horloge de Paris (avec les secondes en fraction). */
export function minutesParis(d: Date | string | number): number {
  const parties = PARTIES.formatToParts(typeof d === 'string' || typeof d === 'number' ? new Date(d) : d);
  const valeur = (type: Intl.DateTimeFormatPartTypes) => Number(parties.find((p) => p.type === type)?.value ?? 0);
  return valeur('hour') * 60 + valeur('minute') + valeur('second') / 60;
}

export interface Bornes {
  /** Minutes depuis minuit, sur une heure pleine. */
  debut: number;
  fin: number;
}

export const DEBUT_JOURNEE = 9 * 60;
export const FIN_JOURNEE = 19 * 60;
const JOUR = 24 * 60;

type Placable = Pick<AppelDuJour, 'debutLe' | 'finLe' | 'dureeSecondes'>;

/** Durée d'un appel en minutes : la durée rapatriée, sinon l'écart début-fin, sinon rien. */
export function dureeMinutes(a: Placable): number {
  if (a.dureeSecondes && a.dureeSecondes > 0) return a.dureeSecondes / 60;
  if (a.finLe) return Math.max(0, (Date.parse(a.finLe) - Date.parse(a.debutLe)) / 60_000);
  return 0;
}

/**
 * De 9 h à 19 h, élargies à l'heure pleine du premier appel et à l'heure pleine qui suit le dernier appel
 * (ou maintenant). Jamais au-delà de minuit.
 */
export function bornesFrise(appels: readonly Placable[], maintenant: number | null): Bornes {
  let premier = Infinity;
  let dernier = -Infinity;
  for (const a of appels) {
    const debut = minutesParis(a.debutLe);
    premier = Math.min(premier, debut);
    dernier = Math.max(dernier, debut + dureeMinutes(a));
  }
  if (maintenant !== null) dernier = Math.max(dernier, maintenant);
  const debut = Number.isFinite(premier) ? Math.min(DEBUT_JOURNEE, Math.floor(premier / 60) * 60) : DEBUT_JOURNEE;
  const fin = Number.isFinite(dernier) ? Math.max(FIN_JOURNEE, Math.ceil(dernier / 60) * 60) : FIN_JOURNEE;
  return { debut, fin: Math.min(JOUR, fin) };
}

/** Position en pourcentage d'une minute du jour, bornée à la frise. */
export function position(minutes: number, b: Bornes): number {
  const p = ((minutes - b.debut) / (b.fin - b.debut)) * 100;
  return Math.min(100, Math.max(0, p));
}

export interface Graduation {
  minutes: number;
  libelle: string;
  position: number;
  /** Une heure sur deux : masquée sous 640 px. */
  secondaire: boolean;
}

/** Une graduation par heure pleine, de la borne de début à l'heure qui précède la fin. */
export function graduations(b: Bornes): Graduation[] {
  const liste: Graduation[] = [];
  for (let m = b.debut, i = 0; m < b.fin; m += 60, i += 1) {
    liste.push({ minutes: m, libelle: `${String(m / 60).padStart(2, '0')}:00`, position: position(m, b), secondaire: i % 2 === 1 });
  }
  return liste;
}

export type FormeTrait = 'vivant' | 'rendez-vous' | 'echec' | 'pointille' | 'normal';

export interface Trait {
  id: string;
  gauche: number;
  largeur: number;
  hauteur: number;
  forme: FormeTrait;
}

export const HAUTEUR_FRISE = 48;
const TRAIT = { min: 4, max: 46 };

type Tracable = Placable &
  Pick<AppelDuJour, 'id' | 'statut' | 'issue' | 'issueSysteme' | 'etapeAtteinte' | 'nombreEtapes'>;

/**
 * Un trait par appel : à son heure de début, large de sa durée, haut de l'étape atteinte du script
 * (décision de l'opérateur). Rendez-vous en encre, échec en point creux brique, analyse et sans bilan en pointillé au
 * minimum, appel vivant en antenne sur toute la hauteur.
 */
export function traitFrise(a: Tracable, b: Bornes, o: { vivant?: boolean } = {}): Trait {
  const gauche = position(minutesParis(a.debutLe), b);
  const largeur = (dureeMinutes(a) / (b.fin - b.debut)) * 100;
  if (o.vivant) return { id: a.id, gauche, largeur: 0, hauteur: HAUTEUR_FRISE, forme: 'vivant' };
  const issue = a.statut === 'termine' ? a.issueSysteme : null;
  const forme: FormeTrait =
    a.statut === 'echec' ? 'echec' : issue === 'rendez-vous-pris' ? 'rendez-vous' : issue ? 'normal' : 'pointille';
  const hauteur = forme === 'pointille' ? TRAIT.min : hauteurTrait(a.etapeAtteinte, a.nombreEtapes, TRAIT);
  return { id: a.id, gauche, largeur, hauteur, forme };
}

/** « 62 appels de 09:02 à 14:31, dont 4 rendez-vous ; appel en cours depuis 14:35. » (lecteurs d'écran). */
export function resumeFrise(appels: readonly Tracable[], vivant: { debutLe: string } | null): string {
  const tries = [...appels].sort((x, y) => Date.parse(x.debutLe) - Date.parse(y.debutLe));
  const premier = tries[0];
  const dernier = tries.at(-1);
  const rdv = tries.filter((a) => a.statut === 'termine' && a.issueSysteme === 'rendez-vous-pris').length;
  let phrase =
    !premier || !dernier
      ? 'Aucun appel aujourd’hui.'
      : tries.length === 1
        ? `1 appel à ${heure(premier.debutLe)}`
        : `${tries.length} appels de ${heure(premier.debutLe)} à ${heure(dernier.debutLe)}`;
  if (premier) phrase += rdv === 0 ? '.' : `, dont ${rdv} rendez-vous.`;
  if (vivant) phrase = `${phrase.slice(0, -1)} ; appel en cours depuis ${heure(vivant.debutLe)}.`;
  return phrase;
}
