/**
 * Enchaînement des appels d'une campagne sur la ligne navigateur (régie). Fonctions pures, testées : le
 * décompte vers l'appel suivant ne part qu'après un geste de l'opérateur, et jamais derrière une connexion
 * ratée (sans quoi une connexion à Mina qui échoue en boucle consommerait toute la file).
 */

export interface EtatEnchainement {
  /** L'opérateur a appelé dans cette page : les appels suivants partent après un décompte. */
  geste: boolean;
  /** Le prospect du dernier appel parti de cette page. */
  dernier: string | null;
  /** Message de la dernière connexion ratée, jusqu'au prochain geste. */
  echec: string | null;
}

export const ENCHAINEMENT_INITIAL: EtatEnchainement = { geste: false, dernier: null, echec: null };

/** L'opérateur appelle (ou le décompte arrive à zéro) : ce prospect devient le dernier appelé. */
export function appelLance(e: EtatEnchainement, prospectId: string): EtatEnchainement {
  return { ...e, geste: true, dernier: prospectId, echec: null };
}

/** Fin d'un appel : après une connexion ratée, l'enchaînement s'arrête et attend un nouveau geste. */
export function appelFini(e: EtatEnchainement, fin?: { echec: string }): EtatEnchainement {
  return fin ? { ...e, geste: false, echec: fin.echec } : e;
}

/** Le décompte vers ce prospect part-il tout seul ? */
export function decompteAttendu(e: EtatEnchainement, prochainId: string): boolean {
  return e.geste && e.echec === null && prochainId !== e.dernier;
}
