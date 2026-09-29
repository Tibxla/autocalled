'use client';

import Link from 'next/link';
import { useCallback, useRef, type ComponentProps, type Ref } from 'react';
import { toucheAria, useRaccourci, type GroupeRaccourci } from './clavier';
import { Touches } from './touche';

/**
 * Actions en texte précédées de leur touche : jamais de fond plein ni de contour (fin de la paire bouton
 * plein + bouton contour). Un raccourci ne fait que le même clic que la souris ; ce clic ouvre une
 * Confirmation quand le geste fait sonner un téléphone, détruit, révoque ou desserre un garde-fou.
 *
 * Au doigt (`pointer-coarse:`, seul critère tactile), la touche disparaît et l'action devient la touche :
 * la forme « relief » pose le libellé dans le relief de `<kbd>` agrandi à 44 px, sur `surface` ; la forme
 * « texte » reste un mot, souligné en permanence. Tout est derrière `pointer-coarse:` : au pointeur fin,
 * rien ne change. Défaut : relief pour le ton fort, texte pour les autres ; le ton discret reste toujours du
 * texte. Une seule action en relief par zone, sauf le pavé des commandes de ce qui vit (appel, campagne).
 */

export type TonAction = 'fort' | 'normal' | 'discret' | 'alerte';
export type FormeAction = 'relief' | 'texte';

interface OptionsAction {
  /** Défaut 'normal'. */
  ton?: TonAction;
  /** Au doigt seulement. Défaut : 'relief' pour le ton fort, 'texte' sinon ; toujours 'texte' pour le ton discret. */
  forme?: FormeAction;
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
  'group inline-flex h-9 items-center gap-2 rounded-[4px] px-1.5 text-left text-md whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 pointer-coarse:h-11 pointer-coarse:min-w-11';

const TONS: Record<TonAction, string> = {
  fort: 'font-semibold text-encre',
  normal: 'font-medium text-encre-2 hover:text-encre',
  discret: 'text-encre-3 hover:text-encre-2',
  alerte: 'font-medium text-alerte',
};

/** Forme texte au doigt : l'appui se voit par le voile de ligne (le soulignement est porté par le libellé). */
const TEXTE = 'pointer-coarse:active:bg-survol';

/**
 * Forme relief au doigt : le cadre d'un pixel et le bord bas appuyé de la touche, agrandis. Appuyée, le bord bas
 * s'efface et le fond passe en filet-2 : la touche paraît enfoncée, sans mouvement. `mx-0` annule le retrait
 * négatif qu'un appelant pose pour aligner le texte sur la colonne.
 */
const RELIEF_COMMUN = 'pointer-coarse:mx-0 pointer-coarse:px-4 pointer-coarse:justify-center';
const RELIEF: Record<Exclude<TonAction, 'discret'>, string> = {
  fort: 'pointer-coarse:bg-surface pointer-coarse:shadow-[inset_0_0_0_1px_var(--trait),inset_0_-1px_0_var(--trait)] pointer-coarse:active:bg-filet-2 pointer-coarse:active:shadow-[inset_0_0_0_1px_var(--trait)]',
  normal:
    'pointer-coarse:bg-surface pointer-coarse:shadow-[inset_0_0_0_1px_var(--filet-fort),inset_0_-1px_0_var(--filet-fort)] pointer-coarse:active:bg-filet-2 pointer-coarse:active:shadow-[inset_0_0_0_1px_var(--filet-fort)]',
  alerte:
    'pointer-coarse:bg-alerte-fond pointer-coarse:shadow-[inset_0_0_0_1px_var(--alerte),inset_0_-1px_0_var(--alerte)] pointer-coarse:active:shadow-[inset_0_0_0_1px_var(--alerte)]',
};

function formeDe(ton: TonAction, forme: FormeAction | undefined): FormeAction {
  if (ton === 'discret') return 'texte';
  return forme ?? (ton === 'fort' ? 'relief' : 'texte');
}

function classesElement(ton: TonAction, forme: FormeAction): string {
  const doigt = forme === 'relief' && ton !== 'discret' ? `${RELIEF_COMMUN} ${RELIEF[ton]}` : TEXTE;
  return `${BASE} ${TONS[ton]} ${doigt}`;
}

/** Soulignement du libellé : au survol partout, en permanence au doigt pour la forme texte. */
const SOULIGNE = 'decoration-souligne decoration-1 underline-offset-4 group-hover:underline group-disabled:no-underline group-aria-disabled:no-underline';
const SOULIGNE_TEXTE = `${SOULIGNE} pointer-coarse:underline`;

/**
 * Les classes d'une action pour un élément écrit à la main, sans libellé intérieur : un `<a href>` externe
 * (« Ouvrir la visio ») ou un `<summary>`. Le soulignement de la forme texte est posé sur l'élément lui-même.
 */
export function classesAction(ton: TonAction, forme?: FormeAction): string {
  const f = formeDe(ton, forme);
  const soulignement =
    f === 'texte'
      ? 'decoration-souligne decoration-1 underline-offset-4 hover:underline pointer-coarse:underline disabled:no-underline aria-disabled:no-underline'
      : 'decoration-souligne decoration-1 underline-offset-4 hover:underline pointer-coarse:no-underline';
  return `${classesElement(ton, f)} ${soulignement}`;
}

function Libelle({
  children,
  enCours,
  libelleEnCours,
  forme,
}: {
  children: React.ReactNode;
  enCours?: boolean;
  libelleEnCours?: string;
  forme: FormeAction;
}) {
  const souligne = forme === 'texte' ? SOULIGNE_TEXTE : SOULIGNE;
  if (!libelleEnCours) return <span className={souligne}>{children}</span>;
  // Les deux libellés superposés : la largeur ne bouge pas pendant l'envoi.
  return (
    <span className="grid *:col-start-1 *:row-start-1">
      <span className={`${souligne} ${enCours ? 'invisible' : ''}`} aria-hidden={enCours || undefined}>
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
  forme,
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
  const f = formeDe(ton, forme);
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
      className={`${classesElement(ton, f)} ${className}`}
      {...props}
    >
      {touche ? <Touches touche={touche} forte={ton === 'fort'} /> : null}
      <Libelle forme={f} enCours={enCours} {...(libelleEnCours ? { libelleEnCours } : {})}>
        {children}
      </Libelle>
    </button>
  );
}

export function LienAction({
  ton = 'normal',
  forme,
  touche,
  raccourci,
  groupeRaccourci,
  libelleRaccourci,
  className = '',
  children,
  ref,
  ...props
}: ComponentProps<typeof Link> & Omit<OptionsAction, 'enCours' | 'libelleEnCours'>) {
  const f = formeDe(ton, forme);
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
      className={`${classesElement(ton, f)} ${className}`}
      {...props}
    >
      {touche ? <Touches touche={touche} forte={ton === 'fort'} /> : null}
      <Libelle forme={f}>{children}</Libelle>
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
