'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { estCourante } from './navigation';

/**
 * Lien de navigation : l'actif en encre, souligné d'1,5 px ; l'inactif en encre-3, souligné d'1 px au survol.
 * Aucune graisse qui change : la navigation ne saute pas. `aussi` rattache d'autres chemins (une campagne
 * relève de Entreprises). `onglet` : text-sm, avec un compte en chasse fixe. 44 px au doigt, où l'appui se voit
 * en encre-2. Une rangée qui déborde (onglets) passe par RangeeDefilante, qui amène l'actif dans la vue.
 */
export function LienNav({
  href,
  children,
  exact = false,
  aussi = [],
  variante = 'principale',
  compte,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
  aussi?: string[];
  variante?: 'principale' | 'onglet';
  compte?: number | string;
}) {
  const chemin = usePathname();
  const actif = estCourante(chemin, { href, exact, aussi });
  const taille = variante === 'onglet' ? 'h-9 text-sm pointer-coarse:h-11' : 'h-10 text-md pointer-coarse:h-11';

  return (
    <Link
      href={href}
      aria-current={actif ? 'page' : undefined}
      className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-encre-3 transition-colors duration-150 hover:text-encre-2 pointer-coarse:active:text-encre-2 aria-[current=page]:text-encre ${taille} after:absolute after:inset-x-0 after:top-[calc(50%+11px)] after:h-px after:bg-souligne after:opacity-0 hover:after:opacity-100 aria-[current=page]:after:h-[1.5px] aria-[current=page]:after:bg-encre aria-[current=page]:after:opacity-100`}
    >
      {children}
      {compte !== undefined ? <span className="font-mono text-encre-3">{compte}</span> : null}
    </Link>
  );
}
