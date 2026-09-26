'use client';

import { useSyncExternalStore } from 'react';

/** État de la ligne partagé entre la conversation en cours et la barre du haut. */
export type EtatLigne = 'libre' | 'en-appel';

let etat: EtatLigne = 'libre';
const abonnes = new Set<() => void>();

export function definirEtatLigne(suivant: EtatLigne) {
  etat = suivant;
  for (const abonne of abonnes) abonne();
}

export function useEtatLigne(): EtatLigne {
  return useSyncExternalStore(
    (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
    () => etat,
    () => 'libre',
  );
}
