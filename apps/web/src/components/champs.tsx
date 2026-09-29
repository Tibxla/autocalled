'use client';

import type { ComponentProps } from 'react';

/**
 * Champs sur filet bas, sans fond ni coins (sauf la zone de texte, posée sur la surface). Le passage du filet
 * à 1,5 px en encre est l'indicateur de focus : pas d'anneau en plus. Cases et boutons radio natifs :
 * `size-4 accent-[var(--encre)]`.
 */

const BASE_FILET =
  'w-full border-0 border-b border-filet-fort bg-transparent text-md text-encre transition-[border-color,box-shadow] duration-150 placeholder:text-encre-3 hover:border-souligne focus:border-encre focus:shadow-[inset_0_-0.5px_0_var(--encre)] focus-visible:outline-none aria-[invalid=true]:border-alerte aria-[invalid=true]:shadow-[inset_0_-0.5px_0_var(--alerte)] disabled:cursor-not-allowed disabled:opacity-45';

export function Saisie({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${BASE_FILET} h-9 px-0 ${className}`} {...props} />;
}

/** `className` va sur l'enveloppe (largeur, placement), comme avant. */
export function Selection({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <div className={`relative ${className}`}>
      <select className={`${BASE_FILET} h-9 cursor-pointer appearance-none pr-6 pl-0`} {...props} />
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

/** Ctrl+Entrée (ou ⌘+Entrée) soumet le formulaire, validation native comprise (`soumissionClavier`, défaut vrai). */
export function ZoneTexte({
  className = '',
  soumissionClavier = true,
  onKeyDown,
  ...props
}: ComponentProps<'textarea'> & { soumissionClavier?: boolean }) {
  return (
    <textarea
      className={`min-h-20 w-full resize-y rounded-md border-0 border-b border-filet-fort bg-surface px-3 py-2 text-base leading-relaxed text-encre transition-[border-color] duration-150 [field-sizing:content] placeholder:text-encre-3 hover:border-souligne focus:border-encre focus-visible:outline-none aria-[invalid=true]:border-alerte disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
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
