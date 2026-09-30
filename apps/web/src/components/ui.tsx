import Link from 'next/link';
import { cloneElement, isValidElement, type ComponentProps, type CSSProperties } from 'react';
import { duree, hauteurTrait, heure } from './format-appel';
import { LienTexte } from './lien-texte';
import { RangeeDefilante } from './rangee-defilante';

/**
 * Primitives de mise en page, de texte, de filtre et de tableau. Sans directive : utilisables côté serveur
 * comme côté client. Les écrans importent tout d'ici, sauf les modules spécialisés (clavier, confirmation,
 * use-formulaire, bande-appel, etat-ligne-telephone, format-appel, garde-fous, url).
 */

export { Touche } from './touche';
export { Action, Bouton, LienAction, LienBouton } from './action';
export { classesAction, type FormeAction, type TonAction } from './classes-action';
export { LIEN_TEXTE, LienTexte } from './lien-texte';
export { Saisie, Selection, ZoneTexte } from './champs';
export { Recherche } from './recherche';

/* ------------------------------------------------------------------ mise en page */

/** pleine (défaut) : sans largeur maximale ; lecture : 72rem aligné à gauche, jamais centré. */
export function Page({ largeur = 'pleine', children, className = '' }: { largeur?: 'pleine' | 'lecture'; children: React.ReactNode; className?: string }) {
  return <div className={`${largeur === 'lecture' ? 'max-w-[72rem]' : ''} ${className}`}>{children}</div>;
}

/** Bande bord à bord malgré la gouttière de la page. */
export function PleineLargeur({
  children,
  className = '',
  as: Balise = 'div',
  'aria-label': libelle,
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'section' | 'div';
  'aria-label'?: string;
}) {
  return (
    <Balise aria-label={libelle} className={`-mx-(--gouttiere) px-(--gouttiere) ${className}`}>
      {children}
    </Balise>
  );
}

export function EnTetePage({
  titre,
  sousTitre,
  action,
  compte,
  retour,
}: {
  titre: string;
  /** Texte ou contenu en ligne (liens, spans) : rendu dans un <p>. */
  sousTitre?: React.ReactNode;
  action?: React.ReactNode;
  compte?: number | string;
  retour?: { href: string; libelle: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-5 max-sm:pt-6 max-sm:pb-4">
      <div className="grid gap-1">
        {/* Indispensable en mode installé : il n'y a plus de bouton retour du navigateur. */}
        {retour ? (
          <LienTexte isole href={retour.href} className="justify-self-start text-sm text-encre-3 hover:text-encre-2">
            {retour.libelle}
          </LienTexte>
        ) : null}
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-balance">
          {titre}
          {compte !== undefined ? <span className="ml-3 font-mono text-md font-normal tracking-normal text-encre-3">{compte}</span> : null}
        </h1>
        {sousTitre ? <p className="max-w-[60ch] text-sm text-encre-3">{sousTitre}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function TitreSection({ children, action, compte, id }: { children: React.ReactNode; action?: React.ReactNode; compte?: number | string; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-filet pb-2.5">
      <h2 id={id} className="text-base font-semibold">
        {children}
        {compte !== undefined ? <span className="ml-2.5 font-mono text-md font-normal text-encre-3">{compte}</span> : null}
      </h2>
      {action}
    </div>
  );
}

/**
 * vide : rien encore, avec le geste suivant en action ; filtre : rien ne correspond, action « Effacer ». L'action
 * suivante est une action forte : au doigt, elle prend le relief, et l'enveloppe lâche son retrait.
 */
export function EtatVide({
  titre,
  children,
  action,
  forme = 'vide',
}: {
  titre: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  forme?: 'vide' | 'filtre';
}) {
  return (
    <div className={`grid justify-items-start gap-2 ${forme === 'vide' ? 'border-b border-filet py-10' : 'py-6'}`}>
      <p className="font-medium">{titre}</p>
      {children ? <div className="max-w-[56ch] text-encre-3">{children}</div> : null}
      {action ? <div className="-mx-1.5 pt-1 pointer-coarse:mx-0">{action}</div> : null}
    </div>
  );
}

export function Message({
  ton,
  titre,
  action,
  children,
  className = '',
}: {
  ton: 'alerte' | 'neutre';
  titre?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={ton === 'alerte' ? 'alert' : 'status'}
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md px-3.5 py-2.5 text-sm ${
        ton === 'alerte' ? 'bg-alerte-fond text-alerte' : 'bg-surface text-encre-2'
      } ${className}`}
    >
      <div className="grid gap-0.5">
        {titre ? <p className="font-medium">{titre}</p> : null}
        <div>{children}</div>
      </div>
      {action ? <div className="-my-1.5 -mr-1.5">{action}</div> : null}
    </div>
  );
}

type ProprietesDecrites = { 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' };

/**
 * Libellé, aide et erreur d'un champ. Câble lui-même aria-describedby (aide et erreur) et aria-invalid sur son
 * enfant unique, sauf si l'enfant les définit déjà : plus aucun appelant n'a à le faire.
 */
export function Champ({
  libelle,
  htmlFor,
  aide,
  erreur,
  complement,
  children,
}: {
  libelle: string;
  htmlFor: string;
  aide?: string;
  erreur?: string | undefined;
  complement?: React.ReactNode;
  children: React.ReactElement;
}) {
  const idAide = aide ? `${htmlFor}-aide` : undefined;
  const idErreur = erreur ? `${htmlFor}-erreur` : undefined;
  let enfant: React.ReactNode = children;
  if (isValidElement<ProprietesDecrites>(children)) {
    const p = children.props;
    const decrit = [p['aria-describedby'], idAide, idErreur].filter(Boolean).join(' ') || undefined;
    enfant = cloneElement(children, {
      'aria-describedby': decrit,
      'aria-invalid': p['aria-invalid'] ?? (erreur ? true : undefined),
    });
  }
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-encre">
          {libelle}
        </label>
        {complement}
      </div>
      {enfant}
      {aide ? (
        <p id={idAide} className="text-sm text-encre-3">
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p id={idErreur} className="text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

/** Rien sous `seuil` × `max` ; au-delà « 212/400 », en alerte quand la limite est dépassée. */
export function Compteur({ valeur, max, seuil = 0.8 }: { valeur: number; max: number; seuil?: number }) {
  if (valeur < seuil * max) return null;
  return (
    <span className={`font-mono text-xs ${valeur > max ? 'text-alerte' : 'text-encre-3'}`}>
      {valeur}/{max}
    </span>
  );
}

/* ------------------------------------------------------------------ filtres */

/**
 * Rangée de filtres. Sous 640 px, toujours une seule rangée qui défile (RangeeDefilante), débordant dans la
 * gouttière, fondue sur le bord qui déborde, le filtre actif amené dans la vue. `rangee` ne décide plus que du
 * bureau : une ligne qui défile au lieu de passer à la ligne (la recherche garde sa place à droite).
 */
export function Filtres({
  libelle,
  children,
  className = '',
  rangee = false,
}: {
  libelle: string;
  children: React.ReactNode;
  className?: string;
  rangee?: boolean;
}) {
  return (
    <RangeeDefilante
      role="group"
      aria-label={libelle}
      className={`gap-x-[22px] gap-y-1 text-md ${rangee ? '' : 'sm:flex-wrap sm:overflow-visible sm:fondu-aucun'} ${className}`}
    >
      {children}
    </RangeeDefilante>
  );
}

const BASE_FILTRE =
  'inline-flex shrink-0 items-baseline gap-1.5 rounded-[4px] py-1 whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:active:text-encre-2';
const FILTRE_ACTIF = 'font-semibold text-encre shadow-[inset_0_-1.5px_0_var(--encre)]';
const FILTRE_INACTIF = 'text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline';

/**
 * Filtre SERVEUR (href : la page relit la base) ou LOCAL (onClick : liste déjà chargée ; l'URL se met à jour
 * par window.history.replaceState, jamais router.replace qui relancerait la page). Un filtre inactif à compte
 * nul reste à sa place, inerte, dès 640 px ; sous 640 px, il quitte la rangée. 44 px au doigt.
 */
export function Filtre({
  actif,
  compte,
  href,
  onClick,
  replace,
  children,
}: {
  actif: boolean;
  compte?: number;
  href?: string;
  onClick?: () => void;
  replace?: boolean;
  children: React.ReactNode;
}) {
  const nombre = compte !== undefined ? <span className="font-mono font-normal text-encre-3">{compte}</span> : null;
  if (compte === 0 && !actif) {
    return (
      <span aria-disabled="true" className={`${BASE_FILTRE} text-trait max-sm:hidden`}>
        {children}
        <span className="font-mono">0</span>
      </span>
    );
  }
  const classes = `${BASE_FILTRE} ${actif ? FILTRE_ACTIF : FILTRE_INACTIF}`;
  if (href !== undefined) {
    return (
      <Link href={href} scroll={false} {...(replace !== undefined ? { replace } : {})} aria-current={actif ? 'true' : undefined} className={classes}>
        {children}
        {nombre}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={actif} className={classes}>
      {children}
      {nombre}
    </button>
  );
}

/* ------------------------------------------------------------------ tableau dense */

/**
 * Tableau en grille (rôles ARIA table, row, columnheader, cell sur des div) : une seule tabulation par ligne,
 * par son LienLigne. Lignes de 38 px ; sous 640 px, deux rangées (le nom seul sur la première, rien qui le
 * coupe ; la seconde ouverte par une cellule `max-sm:basis-full` qui porte l'état, le rappel, l'heure ou le
 * détail d'échec), les cellules masqueeMobile disparaissent, un chevron en bout de ligne dit qu'elle s'ouvre.
 * Rien d'utile dans un `title` : il ne s'affiche jamais au doigt.
 */
export function TableDense({ libelle, colonnes, children, className = '' }: { libelle: string; colonnes: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="table" aria-label={libelle} style={{ '--colonnes': colonnes } as CSSProperties} className={`min-w-0 text-md ${className}`}>
      {children}
    </div>
  );
}

export function EnTeteTable({ children }: { children: React.ReactNode }) {
  return (
    <div role="rowgroup" className="max-sm:sr-only">
      <div role="row" className="grid grid-cols-(--colonnes) gap-4 border-b border-filet-2 py-1.5 text-xs text-encre-3">
        {children}
      </div>
    </div>
  );
}

export function CelluleEnTete({ children, align, masqueeMobile }: { children?: React.ReactNode; align?: 'droite'; masqueeMobile?: boolean }) {
  return (
    <span role="columnheader" className={`${align === 'droite' ? 'text-right' : ''} ${masqueeMobile ? 'max-sm:hidden' : ''}`}>
      {children}
    </span>
  );
}

const ETATS_LIGNE = {
  normale: '',
  vivante: '[&_[data-cellule-etat]]:text-antenne',
  selectionnee: 'bg-survol',
  attenuee: 'text-encre-3',
} as const;

export function LigneTable({
  id,
  etat = 'normale',
  children,
  className = '',
}: {
  id?: string;
  etat?: 'normale' | 'vivante' | 'selectionnee' | 'attenuee';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="row"
      id={id}
      data-ligne=""
      className={`relative flex min-h-[52px] scroll-mt-[calc(var(--hauteur-barre)+8px)] scroll-mb-[calc(var(--hauteur-nav-bas)+8px)] flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-filet py-2 transition-colors duration-100 hover:bg-survol max-sm:has-[[data-lien-ligne]]:pr-6 pointer-coarse:has-[[data-lien-ligne]:active]:bg-survol has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus data-selectionnee:bg-survol sm:grid sm:h-[38px] sm:min-h-0 sm:grid-cols-(--colonnes) sm:gap-4 sm:py-0 ${ETATS_LIGNE[etat]} ${className}`}
    >
      {children}
    </div>
  );
}

export function Cellule({
  children,
  align,
  mono,
  attenuee,
  tronquee,
  titre,
  masqueeMobile,
  etat,
  unite,
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'droite';
  mono?: boolean;
  attenuee?: boolean;
  /** Une ligne coupée dès 640 px ; deux lignes au plus sous 640 px, où rien ne se lit au survol. */
  tronquee?: boolean;
  /** Texte entier au survol d'une cellule tronquée (au pointeur fin seulement : jamais d'information utile). */
  titre?: string;
  masqueeMobile?: boolean;
  /** La cellule d'état : en antenne quand la ligne est vivante. */
  etat?: boolean;
  /** Unité affichée après la valeur sous 640 px (« min », « rendez-vous »), où les en-têtes sont réservés aux lecteurs d'écran. */
  unite?: string;
  className?: string;
}) {
  return (
    <span
      role="cell"
      title={tronquee ? titre : undefined}
      data-cellule-etat={etat ? '' : undefined}
      className={`min-w-0 ${align === 'droite' ? 'sm:text-right' : ''} ${mono ? 'font-mono text-xs text-encre-3' : ''} ${attenuee ? 'text-encre-3' : ''} ${
        tronquee ? 'max-sm:line-clamp-2 max-sm:break-words sm:truncate' : ''
      } ${masqueeMobile ? 'max-sm:hidden' : ''} ${className}`}
    >
      {children}
      {unite ? <span className="sm:hidden">{`\u00a0${unite}`}</span> : null}
    </span>
  );
}

/**
 * Le seul lien d'une ligne (sur le nom) : toute la ligne devient cliquable, le focus se voit sur la ligne. Sous
 * 640 px, un chevron `encre-3` en bout de ligne dit qu'elle s'ouvre (LigneTable lui réserve la place et donne
 * l'appui au doigt).
 */
export function LienLigne({ className = '', children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link data-lien-ligne="" className={`focus-visible:outline-none after:absolute after:inset-0 ${className}`} {...props}>
      {children}
      <Chevron className="absolute top-1/2 right-0 -translate-y-1/2 stroke-encre-3 sm:hidden" />
    </Link>
  );
}

/* ------------------------------------------------------------------ données */

/** Heure de Paris en chasse fixe. */
export function Heure({ date }: { date: Date | string }) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    <time dateTime={d.toISOString()} className="font-mono">
      {heure(d)}
    </time>
  );
}

/** Durée m:ss en chasse fixe, ou rien. */
export function Duree({ secondes }: { secondes: number | null | undefined }) {
  const texte = duree(secondes);
  return texte ? <span className="font-mono">{texte}</span> : <span />;
}

/**
 * Trait vertical de 3 px dont la hauteur suit l'étape atteinte (même règle que la frise de l'accueil).
 * Rendez-vous en encre, vivant en antenne (pleine hauteur), échec en point creux brique ; analyse et sans
 * bilan au minimum.
 */
export function GlypheEtape({
  etape,
  nombre,
  etat = 'bilan',
  rendezVous = false,
  hauteur = 14,
}: {
  etape?: number | null;
  nombre?: number | null;
  etat?: 'bilan' | 'sans-bilan' | 'analyse' | 'echec' | 'vivant';
  rendezVous?: boolean;
  hauteur?: number;
}) {
  if (etat === 'echec') {
    // Un échec n'a pas d'étape : un point creux, pas un trait, pour ne pas se lire comme un appel qui a vécu.
    return (
      <span aria-hidden="true" className="relative inline-flex w-[3px] shrink-0" style={{ height: hauteur }}>
        <PointCreux className="absolute bottom-0 left-1/2 -translate-x-1/2" />
      </span>
    );
  }
  const min = 2;
  const h = etat === 'vivant' ? hauteur : etat === 'analyse' || etat === 'sans-bilan' ? min : hauteurTrait(etape, nombre, { min, max: hauteur });
  const couleur = rendezVous ? 'bg-encre' : etat === 'vivant' ? 'bg-antenne' : 'bg-trait';
  return (
    <span aria-hidden="true" className="inline-flex w-[3px] shrink-0 items-end" style={{ height: hauteur }}>
      <span className={`block w-[3px] ${couleur}`} style={{ height: h }} />
    </span>
  );
}

/**
 * Point creux brique de 7 px : la marque d'une ligne coupée ou d'un échec. La forme porte l'alerte, le libellé
 * voisin reste graphite ; l'antenne pleine est réservée à ce qui vit.
 */
export function PointCreux({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-[7px] shrink-0 rounded-full border-[1.5px] border-alerte align-middle ${className}`} />;
}

/**
 * Rangée d'une liste de définitions dense (à placer dans un <dl className="border-t border-filet">) :
 * intitulé à gauche en encre-3, valeur à droite, une colonne sous 640 px.
 */
export function LigneDefinition({ intitule, children }: { intitule: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-filet py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-sm text-encre-3">{intitule}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Chevron de <details> : « droite » pivote d'un quart quand la ligne s'ouvre, « bas » se retourne (menu).
 * `ouvert` absent : la rotation passe par className (group-open:rotate-90).
 */
export function Chevron({ direction = 'droite', ouvert, className = 'stroke-current' }: { direction?: 'droite' | 'bas'; ouvert?: boolean; className?: string }) {
  const droite = direction === 'droite';
  const rotation = ouvert ? (droite ? 'rotate-90' : 'rotate-180') : '';
  return (
    <svg
      aria-hidden="true"
      viewBox={droite ? '0 0 6 10' : '0 0 10 6'}
      className={`${droite ? 'w-1.5' : 'w-2.5'} shrink-0 fill-none transition-transform duration-150 ${rotation} ${className}`}
    >
      <path d={droite ? 'M1 1l4 4-4 4' : 'M1 1l4 4 4-4'} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LARGEURS_SQUELETTE = ['40%', '55%', '30%', '62%', '45%', '35%', '58%', '28%', '50%', '42%'];

/** Squelette statique d'une liste, sans animation ni reflet ; lignes de 52 px sous 640 px, comme les vraies. */
export function SqueletteListe({ lignes = 10, titre = false, className = 'pt-8' }: { lignes?: number; titre?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      {titre ? <div className="mb-6 h-5 w-40 rounded-[3px] bg-survol" /> : null}
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="flex h-[52px] items-center border-b border-filet sm:h-[38px]">
          <div className="h-3 rounded-[3px] bg-survol" style={{ width: LARGEURS_SQUELETTE[i % LARGEURS_SQUELETTE.length] }} />
        </div>
      ))}
    </div>
  );
}
