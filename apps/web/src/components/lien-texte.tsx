import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Lien en texte : souligné au survol, en permanence au doigt (il n'y a pas de survol pour le révéler). La couleur
 * reste choisie par l'appelant. Module à part, sans directive : la recherche s'en sert, et ui.tsx la réexporte.
 */
export const LIEN_TEXTE = 'decoration-souligne decoration-1 underline-offset-4 hover:underline pointer-coarse:underline';

/**
 * Lien dans une phrase (défaut) : au doigt, la zone de toucher grandit de 14 px en haut et en bas (44 px au moins pour un texte de 13 à 15 px) sans changer
 * la ligne. `isole` : lien seul sur sa ligne (retour, « Tous les rappels »), 44 px de haut au doigt.
 */
export function LienTexte({ isole = false, className = '', ...props }: ComponentProps<typeof Link> & { isole?: boolean }) {
  const zone = isole ? 'pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center' : 'pointer-coarse:py-3.5';
  return <Link className={`${LIEN_TEXTE} ${zone} ${className}`} {...props} />;
}
