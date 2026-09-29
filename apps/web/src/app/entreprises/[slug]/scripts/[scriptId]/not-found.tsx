'use client';

import { useParams } from 'next/navigation';
import { LienAction } from '@/components/action';

/** Script inconnu, ou script d'une autre entreprise. L'en-tête de l'entreprise reste au-dessus. */
export default function ScriptIntrouvable() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2">
      <h2 className="text-lg font-semibold">Ce script n’existe pas dans cette entreprise.</h2>
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-1">
        <LienAction href={`/entreprises/${slug}/scripts`} ton="fort">
          Voir les scripts
        </LienAction>
      </div>
    </div>
  );
}
