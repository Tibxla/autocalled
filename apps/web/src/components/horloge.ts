'use client';

import { useSyncExternalStore } from 'react';

/**
 * Horloge partagée, battant à la seconde tant qu'un composant l'écoute : les chronos lisent l'heure ici et
 * jamais pendant le rendu (Date.now() y est impur). Côté serveur et à l'hydratation, elle vaut 0 : un chrono
 * n'affiche sa valeur qu'une fois monté.
 */

let maintenant = 0;
let minuterie: ReturnType<typeof setInterval> | null = null;
const abonnes = new Set<() => void>();

function battre() {
  maintenant = Date.now();
  for (const a of abonnes) a();
}

function abonner(abonne: () => void) {
  abonnes.add(abonne);
  if (!minuterie) {
    maintenant = Date.now();
    minuterie = setInterval(battre, 1000);
    queueMicrotask(battre);
  }
  return () => {
    abonnes.delete(abonne);
    if (abonnes.size === 0 && minuterie) {
      clearInterval(minuterie);
      minuterie = null;
    }
  };
}

const auRepos = () => () => {};

/** L'heure courante en millisecondes, rafraîchie chaque seconde ; 0 avant le montage ou si `actif` est faux. */
export function useHorloge(actif = true): number {
  return useSyncExternalStore(
    actif ? abonner : auRepos,
    () => (actif ? maintenant : 0),
    () => 0,
  );
}
