import Link from 'next/link';
import type { ComponentProps } from 'react';

const BASE_BOUTON =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45';

const VARIANTES = {
  principal: 'bg-encre text-fond shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-encre/88',
  secondaire: 'bg-surface text-encre shadow-[inset_0_0_0_1px_var(--filet-fort)] hover:bg-survol',
  discret: 'text-encre-2 hover:bg-survol hover:text-encre',
  danger: 'text-alerte hover:bg-alerte-fond',
} as const;

type Variante = keyof typeof VARIANTES;

export function Bouton({ variante = 'principal', className = '', ...props }: ComponentProps<'button'> & { variante?: Variante }) {
  return <button className={`${BASE_BOUTON} ${VARIANTES[variante]} ${className}`} {...props} />;
}

export function LienBouton({
  variante = 'secondaire',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variante?: Variante }) {
  return <Link className={`${BASE_BOUTON} ${VARIANTES[variante]} ${className}`} {...props} />;
}

const BASE_SAISIE =
  'w-full rounded-md bg-surface px-3 py-2 text-base text-encre shadow-[inset_0_0_0_1px_var(--filet-fort)] transition-shadow duration-150 placeholder:text-encre-3 hover:shadow-[inset_0_0_0_1px_var(--encre-3)] focus:shadow-[inset_0_0_0_1.5px_var(--encre)] focus:outline-none aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--alerte)]';

export function Saisie({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${BASE_SAISIE} h-9 ${className}`} {...props} />;
}

export function ZoneTexte({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`${BASE_SAISIE} min-h-20 resize-y leading-relaxed [field-sizing:content] ${className}`} {...props} />;
}

export function Selection({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`${BASE_SAISIE} h-9 ${className}`} {...props} />;
}

export function Champ({
  libelle,
  aide,
  erreur,
  htmlFor,
  children,
}: {
  libelle: string;
  aide?: string;
  erreur?: string | undefined;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {libelle}
      </label>
      {children}
      {erreur ? (
        <p className="text-sm text-alerte">{erreur}</p>
      ) : aide ? (
        <p className="text-sm text-encre-3">{aide}</p>
      ) : null}
    </div>
  );
}

export function EnTetePage({ titre, sousTitre, action }: { titre: string; sousTitre?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pt-12 pb-8">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-balance">{titre}</h1>
        {sousTitre ? <p className="max-w-[60ch] text-encre-2">{sousTitre}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function TitreSection({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-filet pb-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function EtatVide({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="grid justify-items-start gap-2 border-b border-filet py-12">
      <p className="font-medium">{titre}</p>
      <div className="max-w-[56ch] text-encre-2">{children}</div>
    </div>
  );
}

export function Message({ ton, children }: { ton: 'alerte' | 'neutre'; children: React.ReactNode }) {
  return (
    <div
      role={ton === 'alerte' ? 'alert' : 'status'}
      className={`rounded-md px-3.5 py-2.5 text-sm ${ton === 'alerte' ? 'bg-alerte-fond text-alerte' : 'bg-survol text-encre-2'}`}
    >
      {children}
    </div>
  );
}
