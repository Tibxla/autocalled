/**
 * État de la ligne téléphonique, toujours visible. Trait plat tant que rien ne passe ; l'onde
 * s'animera ici quand le pont Bluetooth transmettra un appel (étape 6).
 */
type EtatLigne = 'non-branchee' | 'libre' | 'en-appel';

const LIBELLES: Record<EtatLigne, string> = {
  'non-branchee': 'Ligne non branchée',
  libre: 'Ligne libre',
  'en-appel': 'En appel',
};

export function LigneStatut({ etat }: { etat: EtatLigne }) {
  const vivant = etat === 'en-appel';
  return (
    <div className="flex items-center gap-2.5" role="status">
      <span aria-hidden="true" className={`size-1.5 rounded-full sm:hidden ${vivant ? 'bg-antenne' : 'bg-filet-fort'}`} />
      <svg width="56" className="hidden overflow-visible sm:block" height="16" viewBox="0 0 56 16" aria-hidden="true">
        <line
          x1="0"
          y1="8"
          x2="56"
          y2="8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={etat === 'non-branchee' ? '2 4' : undefined}
          className={vivant ? 'stroke-antenne' : 'stroke-filet-fort'}
        />
      </svg>
      <span className={`text-xs whitespace-nowrap ${vivant ? 'text-antenne' : 'text-encre-3'}`}>{LIBELLES[etat]}</span>
    </div>
  );
}
