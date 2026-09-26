'use client';

import { useEtatLigne } from '@/lib/etat-ligne';
import { Marque } from './marque';

export function MarqueVivante({ className }: { className?: string }) {
  return <Marque enAppel={useEtatLigne() === 'en-appel'} {...(className ? { className } : {})} />;
}
