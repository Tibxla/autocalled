'use client';

import { useParams } from 'next/navigation';
import { LienAction } from '@/components/action';

/** Prospect inconnu, ou prospect d'une autre entreprise. L'en-tête de l'entreprise reste au-dessus. */
export default function ProspectIntrouvable() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2">
      <h2 className="text-lg font-semibold">Ce prospect n’existe pas dans cette entreprise.</h2>
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-1 pointer-coarse:mx-0">
        <LienAction href={`/entreprises/${slug}/prospects`} ton="fort">
          Voir les prospects
        </LienAction>
      </div>
    </div>
  );
}
