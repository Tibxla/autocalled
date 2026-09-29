import { useSyncExternalStore } from 'react';

/**
 * L'heure courante à la minute, pour la ligne « maintenant » de la frise et les fenêtres de temps de la
 * bande. Une seule minuterie, calée sur le changement de minute, tant qu'un composant l'écoute ; côté
 * serveur et à l'hydratation, l'heure du rendu serveur (`initiale`) : rien ne bouge au premier affichage.
 */

let valeur = 0;
let minuterie: ReturnType<typeof setTimeout> | null = null;
const abonnes = new Set<() => void>();

function battre() {
  valeur = Date.now();
  for (const a of abonnes) a();
  minuterie = setTimeout(battre, 60_000 - (valeur % 60_000) + 50);
}

function abonner(abonne: () => void) {
  abonnes.add(abonne);
  if (!minuterie) {
    minuterie = setTimeout(battre, 0);
  }
  return () => {
    abonnes.delete(abonne);
    if (abonnes.size === 0 && minuterie) {
      clearTimeout(minuterie);
      minuterie = null;
    }
  };
}

/** Millisecondes, rafraîchies chaque minute ; `initiale` tant que le client n'a pas lu sa propre horloge. */
export function useMinute(initiale: number): number {
  const lue = useSyncExternalStore(
    abonner,
    () => valeur,
    () => 0,
  );
  return lue || initiale;
}
