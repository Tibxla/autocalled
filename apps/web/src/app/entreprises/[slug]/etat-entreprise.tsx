'use client';

import { usePathname } from 'next/navigation';

/**
 * La ligne d'état de préparation sous le nom de l'entreprise (offre, scripts, prospects, objections, campagne).
 * Sous 640 px, elle ne paraît en entier que sur l'onglet Fiche, où l'on prépare l'entreprise ; ailleurs, seul
 * le lien de la campagne active reste, le reste de la ligne repoussant le travail de l'onglet sous le premier
 * écran. Le layout ne connaît pas le chemin : ce petit composant client le lit, les contenus arrivent déjà
 * rendus par le serveur.
 */
export function EtatEntreprise({ base, elements }: { base: string; elements: { cle: string; contenu: React.ReactNode }[] }) {
  const chemin = usePathname();
  const surFiche = chemin === base;
  const resteMobile = surFiche || elements.some((e) => e.cle === 'campagne');
  return (
    <p className={`mt-1.5 flex flex-wrap gap-x-2 text-sm text-encre-3 ${resteMobile ? '' : 'max-sm:hidden'}`}>
      {elements.map((e, i) => (
        <span key={e.cle} className={`whitespace-nowrap ${surFiche || e.cle === 'campagne' ? '' : 'max-sm:hidden'}`}>
          {e.contenu}
          {/* Le point suit l'élément qu'il clôt : il n'ouvre jamais une ligne. */}
          {i < elements.length - 1 ? (
            <span aria-hidden="true" className="ml-2 text-encre-3">
              ·
            </span>
          ) : null}
        </span>
      ))}
    </p>
  );
}
