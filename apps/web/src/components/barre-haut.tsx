import Link from 'next/link';
import { BoutonAideRaccourcis } from './clavier';
import { LienNav } from './lien-nav';
import { CampagneStatut, LigneStatut, TitreEnAppel } from './ligne-statut';
import { MarqueVivante } from './marque-vivante';
import { NAVIGATION_PRINCIPALE } from './navigation';

/**
 * Barre de 64 px, pleine largeur, collante dès 640 px : marque, navigation, campagne ouverte, état de la ligne, aide des
 * raccourcis. Sous 640 px, une seule rangée de 48 px, non collante : marque, campagne (« Campagne 34/100 ») et état
 * de la ligne ; la navigation descend dans la barre du bas (NavBas).
 */
export function BarreHaut() {
  return (
    <header className="border-b border-filet bg-fond sm:sticky sm:top-0 sm:z-30">
      <div className="flex h-12 items-center px-(--gouttiere) sm:h-16">
        <Link href="/" aria-label="Autocalled, accueil" className="flex h-12 shrink-0 items-center sm:mr-10 sm:h-16">
          <MarqueVivante className="h-[17px] w-auto" />
        </Link>
        <nav aria-label="Navigation principale" className="flex gap-6 max-sm:hidden">
          {NAVIGATION_PRINCIPALE.map((entree) => (
            <LienNav key={entree.href} href={entree.href} {...(entree.exact ? { exact: true } : {})} {...(entree.aussi ? { aussi: entree.aussi } : {})}>
              {entree.libelle}
            </LienNav>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-4 max-sm:gap-3 max-sm:pl-4 xl:pl-6">
          <CampagneStatut />
          <LigneStatut />
          <BoutonAideRaccourcis />
        </div>
        <TitreEnAppel />
      </div>
    </header>
  );
}
