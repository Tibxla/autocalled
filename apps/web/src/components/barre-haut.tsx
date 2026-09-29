import Link from 'next/link';
import { BoutonAideRaccourcis } from './clavier';
import { LienNav } from './lien-nav';
import { LigneStatut, TitreEnAppel } from './ligne-statut';
import { MarqueVivante } from './marque-vivante';

/**
 * Barre de 64 px, pleine largeur, collante dès 640 px : marque, navigation, état de la ligne, aide des
 * raccourcis. Sous 640 px, deux rangées : marque et état (48 px), puis la navigation qui défile seule (40 px).
 */
export function BarreHaut() {
  return (
    <header className="border-b border-filet bg-fond sm:sticky sm:top-0 sm:z-30">
      <div className="flex flex-wrap items-center px-(--gouttiere) sm:h-16 sm:flex-nowrap">
        <Link href="/" aria-label="Autocalled, accueil" className="flex h-12 shrink-0 items-center sm:mr-10 sm:h-16">
          <MarqueVivante className="h-[17px] w-auto" />
        </Link>
        <nav
          aria-label="Navigation principale"
          className="order-last -mx-(--gouttiere) flex w-[calc(100%+2*var(--gouttiere))] gap-6 overflow-x-auto max-sm:gap-4 px-(--gouttiere) [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0"
        >
          <LienNav href="/" exact>
            Accueil
          </LienNav>
          <LienNav href="/entreprises" aussi={['/campagnes']}>
            Entreprises
          </LienNav>
          <LienNav href="/appels">Appels</LienNav>
          <LienNav href="/telephone">Téléphone</LienNav>
          <LienNav href="/reglages">Réglages</LienNav>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <LigneStatut />
          <BoutonAideRaccourcis />
        </div>
        <TitreEnAppel />
      </div>
    </header>
  );
}
