'use client';

import Link from 'next/link';
import { useCallback, useRef, type ComponentProps, type Ref } from 'react';
import { toucheAria, useRaccourci, type GroupeRaccourci } from './clavier';
import { Touches } from './touche';

/**
 * Actions en texte précédées de leur touche : jamais de fond plein ni de contour (fin de la paire bouton
 * plein + bouton contour). Un raccourci ne fait que le même clic que la souris ; ce clic ouvre une
 * Confirmation quand le geste fait sonner un téléphone, détruit, révoque ou desserre un garde-fou.
 */

export type TonAction = 'fort' | 'normal' | 'discret' | 'alerte';

interface OptionsAction {
  /** Défaut 'normal'. */
  ton?: TonAction;
  /** Texte de la Touche affichée devant le libellé (« E », « Espace », « Ctrl Entrée »). */
  touche?: string;
  /** event.key écouté ('e', ' ', 'n'…) : fait le même clic que la souris. */
  raccourci?: string;
  /** Pour l'aide des raccourcis (défaut 'Page'). */
  groupeRaccourci?: GroupeRaccourci;
  /** Pour l'aide (défaut : le libellé s'il est une chaîne). */
  libelleRaccourci?: string;
  enCours?: boolean;
  libelleEnCours?: string;
}

const BASE =
  'group inline-flex h-9 items-center gap-2 rounded-[4px] px-1.5 text-md whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 pointer-coarse:h-11';

const TONS: Record<TonAction, string> = {
  fort: 'font-semibold text-encre',
  normal: 'font-medium text-encre-2 hover:text-encre',
  discret: 'text-encre-3 hover:text-encre-2',
  alerte: 'font-medium text-alerte',
};

const SOULIGNE = 'decoration-souligne decoration-1 underline-offset-4 group-hover:underline group-disabled:no-underline';

function Libelle({ children, enCours, libelleEnCours }: { children: React.ReactNode; enCours?: boolean; libelleEnCours?: string }) {
  if (!libelleEnCours) return <span className={SOULIGNE}>{children}</span>;
  // Les deux libellés superposés : la largeur ne bouge pas pendant l'envoi.
  return (
    <span className="grid *:col-start-1 *:row-start-1">
      <span className={`${SOULIGNE} ${enCours ? 'invisible' : ''}`} aria-hidden={enCours || undefined}>
        {children}
      </span>
      <span className={enCours ? '' : 'invisible'} aria-hidden={!enCours || undefined}>
        {libelleEnCours}
      </span>
    </span>
  );
}

function libelleAide(libelle: string | undefined, children: React.ReactNode, raccourci: string | undefined): string {
  return libelle ?? (typeof children === 'string' ? children : (raccourci ?? ''));
}

export function Action({
  ton = 'normal',
  touche,
  raccourci,
  groupeRaccourci,
  libelleRaccourci,
  enCours = false,
  libelleEnCours,
  className = '',
  type = 'button',
  disabled,
  children,
  ref,
  ...props
}: ComponentProps<'button'> & OptionsAction) {
  const bouton = useRef<HTMLButtonElement | null>(null);
  const attacher = useCallback(
    (noeud: HTMLButtonElement | null) => {
      bouton.current = noeud;
      if (typeof ref === 'function') ref(noeud);
      else if (ref) ref.current = noeud;
    },
    [ref],
  );
  useRaccourci({
    touche: raccourci ?? '',
    libelle: libelleAide(libelleRaccourci, children, raccourci),
    groupe: groupeRaccourci ?? 'Page',
    actif: Boolean(raccourci) && !disabled && !enCours,
    action: () => {
      const b = bouton.current;
      if (!b || b.disabled) return false;
      b.click();
    },
  });
  return (
    <button
      ref={attacher}
      type={type}
      disabled={disabled}
      aria-busy={enCours || undefined}
      aria-keyshortcuts={raccourci ? toucheAria(raccourci) : undefined}
      className={`${BASE} ${TONS[ton]} ${className}`}
      {...props}
    >
      {touche ? <Touches touche={touche} forte={ton === 'fort'} /> : null}
      <Libelle enCours={enCours} {...(libelleEnCours ? { libelleEnCours } : {})}>
        {children}
      </Libelle>
    </button>
  );
}

export function LienAction({
  ton = 'normal',
  touche,
  raccourci,
  groupeRaccourci,
  libelleRaccourci,
  className = '',
  children,
  ref,
  ...props
}: ComponentProps<typeof Link> & Omit<OptionsAction, 'enCours' | 'libelleEnCours'>) {
  const lien = useRef<HTMLAnchorElement | null>(null);
  const externe = ref as Ref<HTMLAnchorElement> | undefined;
  const attacher = useCallback(
    (noeud: HTMLAnchorElement | null) => {
      lien.current = noeud;
      if (typeof externe === 'function') externe(noeud);
      else if (externe) externe.current = noeud;
    },
    [externe],
  );
  useRaccourci({
    touche: raccourci ?? '',
    libelle: libelleAide(libelleRaccourci, children, raccourci),
    groupe: groupeRaccourci ?? 'Page',
    actif: Boolean(raccourci),
    action: () => {
      if (!lien.current) return false;
      lien.current.click();
    },
  });
  return (
    <Link
      ref={attacher}
      aria-keyshortcuts={raccourci ? toucheAria(raccourci) : undefined}
      className={`${BASE} ${TONS[ton]} ${className}`}
      {...props}
    >
      {touche ? <Touches touche={touche} forte={ton === 'fort'} /> : null}
      <Libelle>{children}</Libelle>
    </Link>
  );
}

/* Compatibilité : l'ancienne API reste valide pendant la migration des écrans. */

type Variante = 'principal' | 'secondaire' | 'discret' | 'danger';
const TON_DE_VARIANTE: Record<Variante, TonAction> = { principal: 'fort', secondaire: 'normal', discret: 'discret', danger: 'alerte' };

/** Ancienne API : Action avec `variante` traduite (principal → fort, secondaire → normal, danger → alerte). */
export function Bouton({
  variante = 'principal',
  type = 'submit',
  ...props
}: ComponentProps<'button'> & OptionsAction & { variante?: Variante }) {
  // `type` laissé à l'appelant comme avant : sans précision, un Bouton dans un formulaire le soumet.
  return <Action ton={TON_DE_VARIANTE[variante]} type={type} {...props} />;
}

/** Ancienne API : LienAction avec `variante` traduite. */
export function LienBouton({
  variante = 'secondaire',
  ...props
}: ComponentProps<typeof Link> & Omit<OptionsAction, 'enCours' | 'libelleEnCours'> & { variante?: Variante }) {
  return <LienAction ton={TON_DE_VARIANTE[variante]} {...props} />;
}
