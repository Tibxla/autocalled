import Link from 'next/link';
import { LienNav } from './lien-nav';
import { LigneStatut } from './ligne-statut';

export function BarreHaut() {
  return (
    <header className="border-b border-filet">
      <div className="mx-auto flex h-14 w-full max-w-[72rem] items-center gap-5 px-5 sm:gap-8 sm:px-8">
        <Link href="/entreprises" className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
          Autocalled
        </Link>
        <nav aria-label="Navigation principale" className="flex items-center gap-1">
          <LienNav href="/entreprises">Entreprises</LienNav>
        </nav>
        <div className="ml-auto">
          <LigneStatut etat="non-branchee" />
        </div>
      </div>
    </header>
  );
}
