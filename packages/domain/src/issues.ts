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

/** Ce que recouvre chaque issue système : affiché à l'opérateur et donné à l'analyseur. */
export const SENS_ISSUES: Record<IssueSysteme, string> = {
  'rendez-vous-pris': 'un créneau est réservé dans l’agenda',
  'rappel-convenu': 'le prospect demande qu’on le rappelle à un moment précis',
  'envoi-informations': '« envoyez-moi un mail » : souvent un non poli',
  refus: 'pas intéressé, avec la dernière objection restée sans réponse',
  'pas-le-bon-interlocuteur': 'la personne n’est pas celle qui décide',
  interrompu: 'raccroché avant la fin ; le bilan note l’étape atteinte',
  'non-abouti': 'aucune conversation : exclu des taux de conversion',
};
