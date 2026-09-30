/**
 * Quand proposer « Reconnecter le téléphone ». La liaison Bluetooth du téléphone passerelle peut se figer
 * (téléphone en veille) alors que la ligne le croit connecté : l'action doit rester à portée dès qu'aucun
 * appel n'est en cours, et revenir à côté de chaque échec dû au téléphone.
 *
 * Jamais quand la ligne est injoignable : la reconnexion passe par ce même service, qui ne répond pas.
 * Fonctions pures, testées (reconnexion.test.ts).
 */

/** Sous l'action, là où la place le permet. */
export const AIDE_RECONNEXION = 'Le Bluetooth du téléphone s’est peut-être mis en veille : la reconnexion relance la liaison sans toucher au téléphone.';

/**
 * Vrai quand un appel a échoué parce que le téléphone n'a pas répondu (composition refusée ou sans réponse,
 * canal son jamais ouvert, téléphone absent de la liaison). Faux pour le service de la ligne à terre, un
 * plafond ou une ligne occupée : la reconnexion n'y peut rien.
 */
export function echecDuTelephone(texte: string | null | undefined): boolean {
  if (!texte) return false;
  return /n[’']a pas composé|n[’']a pas ouvert le canal son|composition impossible|aucun téléphone passerelle en ligne/i.test(texte);
}

/** Page Téléphone : un téléphone appairé, pas d'appel en cours ; connecté ou non. */
export function reconnexionTelephone(t: { adresse?: string | null; appelEnCours: boolean } | null): boolean {
  return Boolean(t?.adresse) && !t?.appelEnCours;
}

type LigneAccueil = { joignable: false } | { joignable: true; connecte: boolean; appelEnCours: boolean; appelId: string | null };

/**
 * Accueil, bande « Ligne libre » (fin d'appel, campagne prête ou suspendue, ligne libre) : la ligne répond et ne
 * porte aucun appel. Normale quand le téléphone est dit déconnecté (une fin d'appel s'affiche avant la ligne
 * coupée) ou qu'un échec vient du téléphone ; discrète sinon, pour une liaison figée que la ligne ignore.
 * Null : pas d'action.
 */
export function reconnexionAccueil(ligne: LigneAccueil, echec: string | null = null): 'normal' | 'discret' | null {
  if (!ligne.joignable || ligne.appelEnCours || ligne.appelId) return null;
  return !ligne.connecte || echecDuTelephone(echec) ? 'normal' : 'discret';
}

type EtatPont = 'joignable' | 'injoignable' | 'deconnecte' | 'inconnu';

/** Régie d'une campagne téléphone, hors appel : téléphone déconnecté, ou suspendue après un échec du téléphone. */
export function reconnexionRegie(pont: { etat: EtatPont } | null, raison: string | null): boolean {
  if (pont?.etat === 'injoignable') return false;
  return pont?.etat === 'deconnecte' || echecDuTelephone(raison);
}

/** Fiche prospect : ligne téléphone bloquée pour téléphone déconnecté, ou appel refusé faute de téléphone. */
export function reconnexionFiche(blocageCourt: string | null, erreur: string | null): boolean {
  return blocageCourt === 'déconnecté' || echecDuTelephone(erreur);
}

type EtatLigneRelevee = 'releve' | 'inconnu' | 'injoignable' | 'deconnecte' | 'libre' | 'en-appel';

/**
 * Fiche d'appel : un appel téléphone parti en échec sans conversation, faute de téléphone (composition refusée ou sans
 * réponse, canal son jamais ouvert, téléphone absent de la liaison). Jamais ligne injoignable, pendant un appel, ni
 * avant le premier relevé de la ligne : l'action n'apparaît pas pour disparaître aussitôt.
 */
export function reconnexionAppel(
  appel: { ligne: string; statut: string; conversation: boolean; erreur: string | null },
  etatLigne: EtatLigneRelevee,
): boolean {
  if (appel.ligne !== 'bluetooth' || appel.statut !== 'echec' || appel.conversation || !echecDuTelephone(appel.erreur)) return false;
  return etatLigne === 'libre' || etatLigne === 'deconnecte' || etatLigne === 'inconnu';
}
