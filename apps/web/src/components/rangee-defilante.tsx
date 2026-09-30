'use client';

import { useCallback, useEffect, useRef } from 'react';

const ACTIF_PAR_DEFAUT = '[aria-current]:not([aria-current="false"]),[aria-pressed="true"]';

/**
 * Rangée unique qui défile à l'horizontale, barre masquée, fondue sur le bord qui déborde (24 px, à gauche comme
 * à droite, seulement quand il reste quelque chose à voir de ce côté). Sert aux filtres sous 640 px et aux
 * onglets d'entreprise. Composant client séparé : ui.tsx n'a pas de directive et sert côté serveur.
 *
 * - `debord` (défaut vrai) : sous 640 px, la rangée déborde dans la gouttière, pour que le premier et le dernier
 *   élément viennent au bord de l'écran quand on la fait défiler.
 * - 4 px de marge en haut et en bas, rendus par une marge négative : l'anneau de focus n'est pas rogné.
 * - `actif` : sélecteur de l'élément courant, centré par calcul de `scrollLeft` (jamais `scrollIntoView`, qui
 *   ferait défiler la page) au montage, quand `cle` change et quand l'élément courant change (aria-current,
 *   aria-pressed), pour que ses voisins restent en partie visibles.
 */
export function RangeeDefilante({
  children,
  className = '',
  role,
  'aria-label': libelle,
  debord = true,
  actif = ACTIF_PAR_DEFAUT,
  cle,
}: {
  children: React.ReactNode;
  className?: string;
  role?: string;
  'aria-label'?: string;
  debord?: boolean;
  actif?: string;
  cle?: string;
}) {
  const rangee = useRef<HTMLDivElement>(null);

  const recentrer = useCallback(() => {
    const el = rangee.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const cible = el.querySelector<HTMLElement>(actif);
    if (!cible) return;
    const r = cible.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    el.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
  }, [actif]);

  // Fondus : relus au défilement, au redimensionnement et quand le contenu change.
  useEffect(() => {
    const el = rangee.current;
    if (!el) return;
    const fondus = () => {
      const reste = el.scrollWidth - el.clientWidth - el.scrollLeft;
      el.style.setProperty('--fondu-debut', el.scrollLeft > 1 ? '24px' : '0px');
      el.style.setProperty('--fondu-fin', reste > 1 ? '24px' : '0px');
    };
    fondus();
    el.addEventListener('scroll', fondus, { passive: true });
    const taille = new ResizeObserver(fondus);
    taille.observe(el);
    const contenu = new MutationObserver((changements) => {
      fondus();
      if (changements.some((c) => c.type === 'attributes')) recentrer();
    });
    contenu.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'aria-pressed'] });
    return () => {
      el.removeEventListener('scroll', fondus);
      taille.disconnect();
      contenu.disconnect();
    };
  }, [recentrer]);

  useEffect(() => {
    recentrer();
  }, [cle, recentrer]);

  return (
    <div
      ref={rangee}
      role={role}
      aria-label={libelle}
      className={`fondu-rangee flex flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -my-1 py-1 ${
        debord ? 'max-sm:-mx-(--gouttiere) max-sm:px-(--gouttiere) sm:-mx-1 sm:px-1' : '-mx-1 px-1'
      } ${className}`}
    >
      {children}
    </div>
  );
}
