'use client';

import { useCallback, type ComponentProps } from 'react';

/**
 * Champs sur filet bas, sans fond ni coins (sauf la zone de texte, posée sur la surface). Le passage du filet
 * à 1,5 px en encre est l'indicateur de focus : pas d'anneau en plus. Cases et boutons radio natifs :
 * `size-4 accent-[var(--encre)]`, touchés par tout leur libellé, qui a `pointer-coarse:min-h-11`.
 * Au doigt : 44 px de haut et texte à 16 px (`text-champ`), sous quoi Safari agrandit la page au focus ; on ne
 * touche jamais au zoom du viewport.
 */

const BASE_FILET =
  'w-full border-0 border-b border-filet-fort bg-transparent text-md text-encre pointer-coarse:text-champ transition-[border-color,box-shadow] duration-150 placeholder:text-encre-3 hover:border-souligne focus:border-encre focus:shadow-[inset_0_-0.5px_0_var(--encre)] focus-visible:outline-none aria-[invalid=true]:border-alerte aria-[invalid=true]:shadow-[inset_0_-0.5px_0_var(--alerte)] disabled:cursor-not-allowed disabled:opacity-45';

export function Saisie({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${BASE_FILET} h-9 px-0 pointer-coarse:h-11 ${className}`} {...props} />;
}

/** `className` va sur l'enveloppe (largeur, placement), comme avant. */
export function Selection({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <div className={`relative ${className}`}>
      <select className={`${BASE_FILET} h-9 cursor-pointer appearance-none pr-6 pl-0 pointer-coarse:h-11`} {...props} />
      <svg
        aria-hidden="true"
        viewBox="0 0 10 6"
        className="pointer-events-none absolute top-1/2 right-1 w-2.5 -translate-y-1/2 fill-none stroke-encre-3"
      >
        <path d="M1 1l4 4 4-4" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * Sans `field-sizing: content` (Safari), la hauteur suit le contenu par JavaScript, au doigt seulement : au
 * pointeur fin, la poignée de redimensionnement reste à l'opérateur.
 */
function ajusterHauteur(zone: HTMLTextAreaElement) {
  if (typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')) return;
  if (!matchMedia('(pointer: coarse)').matches) return;
  zone.style.height = 'auto';
  zone.style.height = `${zone.scrollHeight + zone.offsetHeight - zone.clientHeight}px`;
}

/** Ctrl+Entrée (ou ⌘+Entrée) soumet le formulaire, validation native comprise (`soumissionClavier`, défaut vrai). */
export function ZoneTexte({
  className = '',
  soumissionClavier = true,
  onKeyDown,
  onInput,
  ref,
  ...props
}: ComponentProps<'textarea'> & { soumissionClavier?: boolean }) {
  const attacher = useCallback(
    (noeud: HTMLTextAreaElement | null) => {
      if (noeud) ajusterHauteur(noeud);
      if (typeof ref === 'function') ref(noeud);
      else if (ref) ref.current = noeud;
    },
    [ref],
  );
  return (
    <textarea
      ref={attacher}
      className={`min-h-20 w-full resize-y rounded-md border-0 border-b border-filet-fort bg-surface px-3 py-2 text-base leading-relaxed text-encre transition-[border-color] duration-150 [field-sizing:content] placeholder:text-encre-3 hover:border-souligne focus:border-encre focus-visible:outline-none aria-[invalid=true]:border-alerte disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:resize-none pointer-coarse:text-champ ${className}`}
      onInput={(e) => {
        onInput?.(e);
        ajusterHauteur(e.currentTarget);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || !soumissionClavier) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
      }}
      {...props}
    />
  );
}
