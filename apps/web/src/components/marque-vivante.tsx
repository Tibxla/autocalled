'use client';

import { useLigne } from './etat-ligne-telephone';
import { Marque } from './marque';

/** Le point du logo s'allume pendant un appel, téléphone ou navigateur : un seul signal, celui de la ligne. */
export function MarqueVivante({ className }: { className?: string }) {
  return <Marque enAppel={useLigne().etat === 'en-appel'} {...(className ? { className } : {})} />;
}
