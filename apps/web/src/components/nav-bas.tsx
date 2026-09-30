'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLigne } from './etat-ligne-telephone';
import { affichageLigne, TraitLigne } from './ligne-statut';
import { estCourante, NAVIGATION_PRINCIPALE, sansEntreesLarges } from './navigation';

/** Cinq entrées : « Assistante » n'y tient pas, Réglages la porte et s'allume pour elle. */
const ENTREES = sansEntreesLarges(NAVIGATION_PRINCIPALE);

function minusculeInitiale(texte: string): string {
  return texte.charAt(0).toLocaleLowerCase('fr') + texte.slice(1);
}

/**
 * Barre du bas, sous 640 px : la navigation principale descend là où est le pouce (la barre du haut garde une
 * rangée, le bandeau d'appel condensé se colle en haut). Collée au bas de l'écran, 56 px plus la zone de
 * sécurité, filet compris, sur `fond`, fermée en haut par un filet, sans ombre : une barre, pas un calque. Cinq liens texte
 * en Label, chacun large de son libellé plus une part égale de la place restante ; le lien courant en encre,
 * marqué d'un trait de 1,5 px sur le bord haut. Au-dessus de « Téléphone », le trait de la ligne d'état en
 * 16 px ; les autres entrées réservent la même hauteur. Elle s'efface tant qu'un champ a le focus (règle
 * `.nav-bas` de globals.css) : le clavier de l'écran prend sa place. Une seule « Navigation principale » à la
 * fois dans l'arbre : celle du haut est masquée sous 640 px, celle-ci dès 640 px.
 * Mesuré en Chivo 13 px : les cinq libellés font 355 px à leur largeur naturelle (8 px de marge par lien compris),
 * ils tiennent à 360 px ; en dessous, et là seulement, ils passent à 12 px.
 */
export function NavBas() {
  const chemin = usePathname();
  const ligne = affichageLigne(useLigne());
  return (
    <nav
      aria-label="Navigation principale"
      className="nav-bas fixed inset-x-0 bottom-0 z-30 flex border-t border-filet bg-fond pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] sm:hidden"
    >
      {ENTREES.map((entree) => {
        const courante = estCourante(chemin, entree);
        const telephone = entree.href === '/telephone';
        return (
          <Link
            key={entree.href}
            href={entree.href}
            aria-current={courante ? 'page' : undefined}
            aria-label={telephone ? `${entree.libelle}, ${minusculeInitiale(ligne.libelle).replace(' · ', ', ')}` : undefined}
            className="relative flex h-[55px] min-w-0 flex-auto flex-col items-center justify-center gap-1 px-1 text-sm whitespace-nowrap text-encre-3 transition-colors duration-150 before:absolute before:inset-x-0 before:top-0 before:h-[1.5px] before:bg-encre before:opacity-0 active:bg-survol aria-[current=page]:text-encre aria-[current=page]:before:opacity-100 max-[359px]:text-xs"
          >
            <span aria-hidden="true" className="flex h-4 items-center">
              {telephone ? <TraitLigne largeur={16} trait={ligne.trait} couleur={ligne.couleurTrait} /> : null}
            </span>
            {entree.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
