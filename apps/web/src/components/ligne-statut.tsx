'use client';

import { useEtatLigne } from '@/lib/etat-ligne';

/**
 * État de la ligne, toujours visible. Trait pointillé au repos ; rouge « antenne » pendant un appel.
 * La seule ligne branchée pour l'instant est la ligne navigateur (test).
 */
export function LigneStatut() {
  const vivant = useEtatLigne() === 'en-appel';
  return (
    <div className="flex items-center gap-2.5" role="status">
      <span aria-hidden="true" className={`size-1.5 rounded-full sm:hidden ${vivant ? 'bg-antenne' : 'bg-filet-fort'}`} />
      <svg width="56" height="16" viewBox="0 0 56 16" aria-hidden="true" className="hidden overflow-visible sm:block">
        <line
          x1="0"
          y1="8"
          x2="56"
          y2="8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={vivant ? undefined : '2 4'}
          className={`transition-colors duration-300 ${vivant ? 'stroke-antenne' : 'stroke-filet-fort'}`}
        />
      </svg>
      <span className={`text-xs whitespace-nowrap ${vivant ? 'text-antenne' : 'text-encre-3'}`}>
        {vivant ? 'En appel' : 'Ligne navigateur'}
      </span>
    </div>
  );
}
