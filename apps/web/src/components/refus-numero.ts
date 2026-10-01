import type { Appelabilite, RaisonRefus } from '@autocalled/domain';

/** Pourquoi un numéro ne serait pas composé, en fin de phrase : « Numéro invalide », « Numéro d’une personne effacée ». */
export const REFUS_NUMERO: Record<RaisonRefus, string> = {
  'numero-invalide': 'invalide',
  'numero-efface': 'd’une personne effacée',
  'opposition-illisible': 'non vérifiable (liste d’opposition illisible)',
};

/** La raison du refus d'un numéro vérifié, ou null s'il peut être composé. Un numéro absent de la vérification est invalide. */
export function refusDe(a: Appelabilite | undefined): RaisonRefus | null {
  if (!a) return 'numero-invalide';
  return a.appelable ? null : a.raison;
}
