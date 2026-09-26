/**
 * Les sept issues système : le comportement du produit en dépend (rendez-vous réservé, rappel à
 * faire, appel exclu des taux de conversion). Une issue personnalisée se rattache toujours à l'une d'elles.
 */
export const ISSUES_SYSTEME = [
  'rendez-vous-pris',
  'rappel-convenu',
  'envoi-informations',
  'refus',
  'pas-le-bon-interlocuteur',
  'interrompu',
  'non-abouti',
] as const;

export type IssueSysteme = (typeof ISSUES_SYSTEME)[number];

export const LIBELLES_ISSUES: Record<IssueSysteme, string> = {
  'rendez-vous-pris': 'Rendez-vous pris',
  'rappel-convenu': 'Rappel convenu',
  'envoi-informations': "Envoi d'informations",
  refus: 'Refus',
  'pas-le-bon-interlocuteur': 'Pas le bon interlocuteur',
  interrompu: 'Interrompu',
  'non-abouti': 'Non abouti',
};
