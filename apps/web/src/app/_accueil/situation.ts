import type { AppelDuJour, AppelVivant, CampagneJour, EtatLigneServeur } from '@/lib/accueil';

/**
 * Ce que montre la bande du haut de l'accueil quand elle ne suit pas un appel, ou qu'elle en suit un.
 * Une seule situation à la fois, par priorité : appel téléphone vivant (appelId donné par la ligne, jamais le
 * seul statut en base) > fin d'appel (moins de 15 min, toutes lignes) > campagne en cours hors téléphone
 * > ligne coupée > plafond > campagne entre deux appels > campagne suspendue > campagne prête > ligne libre.
 * Fonction pure, testée.
 */

export type Situation =
  | { type: 'appel'; appelId: string | null; appel: AppelVivant | null }
  | { type: 'ligne-coupee'; raison: 'injoignable' | 'deconnecte'; campagne: CampagneJour | null; entrepriseSlug: string | null }
  | { type: 'plafond'; phrase: string; campagne: CampagneJour | null }
  | { type: 'fin-appel'; appel: AppelDuJour; bloquee: boolean }
  | { type: 'campagne-entre-deux'; campagne: CampagneJour }
  | { type: 'campagne-suspendue'; campagne: CampagneJour; raison: RaisonSuspension | null }
  | { type: 'campagne-prete'; campagne: CampagneJour }
  | { type: 'libre'; dernier: AppelDuJour | null; premiereUtilisation: boolean; entrepriseSlug: string | null };

export type RaisonSuspension = { texte: string; ton: 'alerte' };

/** Un appel terminé reste en haut de la bande ce temps-là (bilan qui tombe, échec). */
export const FENETRE_FIN_MS = 15 * 60 * 1000;
/** Au-delà, une analyse sans nouvelle ne progresse plus : l'accueil cesse de se rafraîchir pour elle. */
export const ANALYSE_BLOQUEE_MS = 5 * 60 * 1000;

const TELEPHONE = new Set(['bluetooth']);

function heureDeFin(a: { finLe: string | null; debutLe: string }): number {
  return Date.parse(a.finLe ?? a.debutLe);
}

/** La campagne téléphone qui tourne ou attend, à rappeler quand la ligne ne peut rien faire. */
function campagneTelephoneOuverte(campagnes: readonly CampagneJour[]): CampagneJour | null {
  return campagnes.find((c) => TELEPHONE.has(c.ligne) && (c.statut === 'en-cours' || c.statut === 'en-pause')) ?? null;
}

/**
 * Pourquoi une campagne est suspendue, quand on peut le déduire sans l'inventer : dernier appel en échec,
 * plafond, ligne coupée. Sinon null (« Aucun appel ne part avant la reprise. »), sans prétendre savoir qui
 * l'a suspendue.
 */
export function raisonSuspension(campagne: CampagneJour, ligne: EtatLigneServeur): RaisonSuspension | null {
  if (TELEPHONE.has(campagne.ligne)) {
    if (!ligne.joignable) return { texte: 'La ligne est injoignable : aucun appel ne peut partir par le téléphone passerelle.', ton: 'alerte' };
    if (!ligne.connecte) return { texte: 'Le téléphone passerelle est déconnecté.', ton: 'alerte' };
    if (ligne.plafond) return { texte: ligne.plafond, ton: 'alerte' };
  }
  const d = campagne.dernierAppel;
  if (d?.statut === 'echec' && !d.conversation) {
    return { texte: `L’appel de ${d.prospect} n’est pas parti${d.erreur ? ` : ${d.erreur}` : '.'}`, ton: 'alerte' };
  }
  return null;
}

/** Vrai quand la ligne ne laisse partir aucun appel téléphone (Reprendre et Lancer au téléphone sont alors désactivés). */
export function ligneBloquee(ligne: EtatLigneServeur): string | null {
  if (!ligne.joignable) return 'La ligne est injoignable.';
  if (!ligne.connecte) return 'Le téléphone passerelle est déconnecté.';
  if (ligne.plafond) return 'Le plafond d’appels est atteint.';
  return null;
}

export function situationAccueil(e: {
  ligne: EtatLigneServeur;
  appelVivant: AppelVivant | null;
  appels: readonly AppelDuJour[];
  campagnes: readonly CampagneJour[];
  premiereUtilisation: boolean;
  maintenant: number;
}): Situation {
  const { ligne, campagnes, appels } = e;

  // 1. Un appel téléphone vivant : seul le pont le dit.
  if (ligne.joignable && (ligne.appelEnCours || ligne.appelId)) {
    const appel = ligne.appelId && e.appelVivant?.id === ligne.appelId ? e.appelVivant : null;
    return { type: 'appel', appelId: ligne.appelId, appel };
  }

  // 2. Fin d'appel, toutes lignes : le dernier appel terminé du jour, s'il a fini il y a moins de 15 min.
  // Elle passe avant l'état de la ligne : le bilan d'une démo en ligne navigateur tombe même téléphone coupé
  // (la barre du haut dit déjà l'état de la ligne).
  const dernierFini = appels.find((a) => a.statut !== 'en-cours');
  const plusRecent = appels[0];
  if (dernierFini && plusRecent === dernierFini) {
    const depuis = e.maintenant - heureDeFin(dernierFini);
    if (depuis >= 0 && depuis < FENETRE_FIN_MS) {
      return { type: 'fin-appel', appel: dernierFini, bloquee: dernierFini.statut === 'traitement' && depuis > ANALYSE_BLOQUEE_MS };
    }
  }

  // 3. Une campagne qui tourne sans le téléphone (navigateur, simulation) : la ligne coupée ne la gêne pas.
  const enCours = campagnes.find((c) => c.statut === 'en-cours');
  if (enCours && !TELEPHONE.has(enCours.ligne)) return { type: 'campagne-entre-deux', campagne: enCours };

  // 4. Ligne coupée, avec l'entreprise de la démo de secours (ligne navigateur).
  const entrepriseSlug = appels[0]?.entrepriseSlug ?? campagnes[0]?.entrepriseSlug ?? null;
  if (!ligne.joignable) return { type: 'ligne-coupee', raison: 'injoignable', campagne: campagneTelephoneOuverte(campagnes), entrepriseSlug };
  if (!ligne.connecte) return { type: 'ligne-coupee', raison: 'deconnecte', campagne: campagneTelephoneOuverte(campagnes), entrepriseSlug };

  // 5. Plafond atteint.
  if (ligne.plafond) return { type: 'plafond', phrase: ligne.plafond, campagne: campagneTelephoneOuverte(campagnes) };

  // 6 à 8. Campagnes, la plus récente d'abord.
  if (enCours) return { type: 'campagne-entre-deux', campagne: enCours };
  const suspendue = campagnes.find((c) => c.statut === 'en-pause');
  if (suspendue) return { type: 'campagne-suspendue', campagne: suspendue, raison: raisonSuspension(suspendue, ligne) };
  const prete = campagnes.find((c) => c.statut === 'prete');
  if (prete) return { type: 'campagne-prete', campagne: prete };

  // 9. Ligne libre.
  const dernier = appels[0] ?? null;
  return {
    type: 'libre',
    dernier,
    premiereUtilisation: e.premiereUtilisation,
    entrepriseSlug,
  };
}
