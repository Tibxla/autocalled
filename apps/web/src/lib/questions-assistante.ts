/**
 * Les textes des confirmations de la page Assistante qui ne dépendent d'aucune lecture : la page les affiche, et
 * lib/edition-assistante.ts garde le même texte au journal des gestes (ADR 0016). Sans dépendance serveur : lu par
 * des composants client.
 */

export const RAPATRIEMENT = {
  question: 'Réécrire agent/ d’après ElevenLabs ?',
  explication:
    'Les fichiers de agent/ prennent la configuration actuelle d’ElevenLabs (modifiée dans le tableau de bord, par exemple), consignée dans l’historique. Refusé s’il reste des modifications non poussées. Rien ne change pour les appels.',
} as const;

export const RESTAURATION = {
  question: 'Restaurer cette version dans agent/ ?',
  explication:
    'Les fichiers de agent/ reprennent le prompt et les réglages de cette version. Rien ne change pour les appels avant la poussée. Refusé s’il reste des modifications non poussées.',
  identique: 'Les fichiers sont déjà identiques à cette version.',
  difference: 'De cette version vers les fichiers actuels (ce que la restauration défait) :',
} as const;

export const POUSSEE = {
  question: 'Pousser cette différence vers ElevenLabs ?',
  difference: 'De la configuration ElevenLabs actuelle vers les fichiers de agent/ :',
} as const;
