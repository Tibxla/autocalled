import Link from 'next/link';
import { BoutonAideRaccourcis } from './clavier';
import { LienNav } from './lien-nav';
import { CampagneStatut, LigneStatut, TitreEnAppel } from './ligne-statut';
import { MarqueVivante } from './marque-vivante';
import { type EntreeNav, NAVIGATION_PRINCIPALE } from './navigation';

/**
 * Barre de 64 px, pleine largeur, collante dès 640 px : marque, navigation, campagne ouverte, état de la ligne, aide des
 * raccourcis. Sous 640 px, une seule rangée de 48 px, non collante : marque, campagne (« Campagne 34/100 ») et état
 * de la ligne ; la navigation descend dans la barre du bas (NavBas). De 640 à 767 px, ni campagne ni « Raccourcis » :
 * la navigation et l'état court de la ligne prennent la rangée. « Assistante » n'y paraît que dès 1280 px ; en
 * dessous, Réglages porte la page et s'allume pour elle : ses deux liens, l'un par largeur, ne sont jamais visibles
 * ensemble (un lien masqué sort de l'arbre d'accessibilité).
 */
export function BarreHaut() {
  return (
    <header className="border-b border-filet bg-fond sm:sticky sm:top-0 sm:z-30">
      <div className="flex h-12 items-center px-(--gouttiere) sm:h-16">
        <Link href="/" aria-label="Autocalled, accueil" className="flex h-12 shrink-0 items-center sm:mr-4 sm:h-16 md:mr-6 lg:mr-10">
          <MarqueVivante className="h-[17px] w-auto" />
        </Link>
        <nav aria-label="Navigation principale" className="flex gap-3 max-sm:hidden md:gap-4 lg:gap-6">
          {NAVIGATION_PRINCIPALE.flatMap((entree) =>
            entree.aussiSansLarge
              ? [
                  lien(entree, 'xl:hidden', `${entree.href}-etroit`, [...(entree.aussi ?? []), ...entree.aussiSansLarge]),
                  lien(entree, 'max-xl:hidden', entree.href),
                ]
              : [lien(entree, entree.large ? 'max-xl:hidden' : '', entree.href)],
          )}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 max-sm:gap-6 max-sm:pl-4 lg:gap-4 xl:pl-6">
          {/* De 640 à 767 px, la navigation prend la place : la campagne reste sur l'accueil et sa fiche. */}
          <div className="contents sm:max-md:hidden">
            <CampagneStatut />
          </div>
          <LigneStatut />
          <BoutonAideRaccourcis />
        </div>
        <TitreEnAppel />
      </div>
    </header>
  );
}

function lien(entree: EntreeNav, className: string, cle: string, aussi = entree.aussi) {
  return (
    <LienNav key={cle} href={entree.href} className={className} {...(entree.exact ? { exact: true } : {})} {...(aussi ? { aussi } : {})}>
      {entree.libelle}
    </LienNav>
  );
}
