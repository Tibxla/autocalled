'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { Touche } from './touche';

/**
 * Raccourcis clavier de toute l'application : UN seul écouteur keydown sur le document, posé par
 * FournisseurClavier, et un registre où chaque composant monté inscrit ses touches.
 *
 * Règle absolue : aucun raccourci n'écrit ni n'appelle. Une touche peut naviguer, ouvrir un panneau,
 * ouvrir une Confirmation ou basculer un état local (écoute, micro) ; seule Entrée dans une Confirmation
 * ouverte valide un geste, et Ctrl+Entrée soumet un formulaire visible.
 *
 * Carte des touches réservées (pour que les écrans ne se marchent pas dessus) :
 * - Appel (bande d'appel montée, appel en ligne) : E écouter, Espace prendre la main, M micro, T fil.
 * - Liste (NavigationListe) : j ou ↓, k ou ↑, Entrée (natif), Début, Fin.
 * - Confirmation : Entrée, Échap. Formulaires : Ctrl+Entrée.
 * - Pages : N nouvelle entreprise, objection, script ou campagne (ouvre, n'écrit pas) ; I importer (volet) ;
 *   V nouvelle version ; R relire (Téléphone) ; 1 à 8 onglets d'entreprise ; j et k élément suivant et
 *   précédent sur une fiche ; lecteur d'un appel terminé : Espace, ← →, ↑ ↓, Échap.
 * - Globaux : ? aide, / recherche (puis ↓ vers les résultats), g puis h, e, a, t, r (retenus par la garde
 *   de sortie pendant un appel navigateur).
 * - Jamais de touche seule pour Raccrocher, Lancer, Reprendre, Suspendre, Révoquer, Oublier, Archiver,
 *   Réanalyser, Importer, Enregistrer, Appeler.
 */

export type GroupeRaccourci = 'Appel' | 'Liste' | 'Navigation' | 'Page' | 'Confirmation';
export type CoucheRaccourci = 'global' | 'page' | 'confirmation' | 'aide';

export interface Raccourci {
  /** event.key ; lettres comparées sans casse ; ' ' pour Espace ; 'Escape', 'Enter', 'ArrowDown'… ; un chiffre seul se compare sur event.code. */
  touche: string;
  /** event.code, prioritaire si présent (chiffres : 'Digit1', AZERTY sans Maj). */
  code?: string;
  /** Raccourci à deux temps : g puis la touche, dans une fenêtre de 1,5 s. */
  sequence?: 'g';
  libelle: string;
  groupe?: GroupeRaccourci;
  /**
   * Renvoyer `false` signifie « pas pris » : l'événement passe au raccourci suivant, puis au navigateur
   * (↓ hors de la liste, par exemple, garde le défilement natif).
   */
  action: (e: KeyboardEvent) => void | boolean;
  actif?: boolean;
  dansChamp?: boolean;
  ctrl?: boolean;
  repetition?: boolean;
  couche?: CoucheRaccourci;
}

/* ------------------------------------------------------------------ registre */

type Fournisseur = { ordre: number; lire: () => readonly Raccourci[] };

const registre = new Map<number, Fournisseur>();
let prochainId = 1;
let prochainOrdre = 1;

function inscrire(lire: () => readonly Raccourci[]): () => void {
  const id = prochainId++;
  registre.set(id, { ordre: prochainOrdre++, lire });
  return () => {
    registre.delete(id);
  };
}

/** Les raccourcis actifs, du dernier inscrit au premier. */
function raccourcisActifs(): Raccourci[] {
  return [...registre.values()]
    .sort((a, b) => b.ordre - a.ordre)
    .flatMap((f) => f.lire())
    .filter((r) => r.actif !== false && r.touche !== '');
}

/** Inscrit une liste de raccourcis tant que le composant est monté ; la liste est relue à chaque touche. */
export function useRaccourcis(liste: readonly Raccourci[]): void {
  const courante = useRef(liste);
  useEffect(() => {
    courante.current = liste;
  });
  useEffect(() => inscrire(() => courante.current), []);
}

export function useRaccourci(r: Raccourci): void {
  useRaccourcis([r]);
}

/* ------------------------------------------------------------------ cible de la recherche */

const recherches: HTMLInputElement[] = [];

/** Le dernier champ Recherche monté reçoit « / ». Renvoie de quoi le retirer. */
export function inscrireRecherche(champ: HTMLInputElement): () => void {
  recherches.push(champ);
  return () => {
    const i = recherches.lastIndexOf(champ);
    if (i >= 0) recherches.splice(i, 1);
  };
}

/* ------------------------------------------------------------------ garde de navigation */

let gardeNavigation: ((destination: string) => void) | null = null;

/**
 * Pendant un appel navigateur, GardeSortie inscrit ici sa confirmation : les séquences « g puis… », qui
 * passent par router.push sans clic, la demandent au lieu de quitter la page. Renvoie de quoi la retirer.
 */
export function inscrireGardeNavigation(garde: (destination: string) => void): () => void {
  gardeNavigation = garde;
  return () => {
    if (gardeNavigation === garde) gardeNavigation = null;
  };
}

/* ------------------------------------------------------------------ aide (magasin) */

type EtatAide = { ouverte: boolean; entrees: readonly Raccourci[] };
let aide: EtatAide = { ouverte: false, entrees: [] };
let declencheurAide: HTMLElement | null = null;
const abonnesAide = new Set<() => void>();
const AIDE_SERVEUR: EtatAide = { ouverte: false, entrees: [] };

function poserAide(suivant: EtatAide) {
  aide = suivant;
  for (const a of abonnesAide) a();
}

function abonnerAide(abonne: () => void) {
  abonnesAide.add(abonne);
  return () => {
    abonnesAide.delete(abonne);
  };
}

export function ouvrirAide(declencheur?: HTMLElement | null) {
  declencheurAide = declencheur ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  poserAide({ ouverte: true, entrees: raccourcisActifs().filter((r) => r.couche !== 'aide' && r.couche !== 'confirmation') });
}

export function fermerAide() {
  if (!aide.ouverte) return;
  poserAide({ ouverte: false, entrees: [] });
  const retour = declencheurAide;
  declencheurAide = null;
  if (retour?.isConnected) requestAnimationFrame(() => retour.focus());
}

export function basculerAide(declencheur?: HTMLElement | null) {
  if (aide.ouverte) fermerAide();
  else ouvrirAide(declencheur);
}

function useAide(): EtatAide {
  return useSyncExternalStore(
    abonnerAide,
    () => aide,
    () => AIDE_SERVEUR,
  );
}

/* ------------------------------------------------------------------ gestionnaire */

/** Ce qu'Entrée active nativement : liens compris. */
const ACTIVABLES =
  'button, a[href], summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="file"], input[type="range"]';
/** Ce qu'Espace active nativement : jamais un lien (Espace sur un lien fait défiler la page, rien d'autre). */
const ACTIVABLES_ESPACE =
  'button, summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="file"], input[type="range"]';
const TEXTUELS_NON = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden']);

function estChamp(cible: Element | null): boolean {
  if (!cible) return false;
  if (cible instanceof HTMLInputElement) return !TEXTUELS_NON.has(cible.type);
  if (cible instanceof HTMLTextAreaElement || cible instanceof HTMLSelectElement) return true;
  return cible instanceof HTMLElement && cible.isContentEditable;
}

function estActivable(cible: Element | null, selecteur = ACTIVABLES): boolean {
  return Boolean(cible?.closest(selecteur));
}

function correspond(r: Raccourci, e: KeyboardEvent): boolean {
  if (r.code) return e.code === r.code || (r.code.startsWith('Digit') && e.code === `Numpad${r.code.slice(5)}`);
  if (/^\d$/.test(r.touche)) return e.code === `Digit${r.touche}` || e.code === `Numpad${r.touche}`;
  if (r.touche.length === 1 && r.touche.toLowerCase() !== r.touche.toUpperCase()) return e.key.toLowerCase() === r.touche.toLowerCase();
  return e.key === r.touche;
}

const RANG_COUCHE: Record<CoucheRaccourci, number> = { aide: 3, confirmation: 2, page: 1, global: 0 };
const FENETRE_SEQUENCE_MS = 1500;
let sequenceG = 0;

function surTouche(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.altKey) return;
  const cible = e.target instanceof Element ? e.target : null;
  const dansChamp = estChamp(cible);
  const activable = estActivable(cible);
  const activableEspace = estActivable(cible, ACTIVABLES_ESPACE);
  const ctrl = e.ctrlKey || e.metaKey;

  const actifs = raccourcisActifs();
  // Une aide ou une confirmation ouverte masque tout le reste : seules ses touches répondent.
  const haute = actifs.reduce((max, r) => Math.max(max, RANG_COUCHE[r.couche ?? 'page']), 0);
  const candidats = (haute >= RANG_COUCHE.confirmation ? actifs.filter((r) => RANG_COUCHE[r.couche ?? 'page'] === haute) : actifs).sort(
    (a, b) => RANG_COUCHE[b.couche ?? 'page'] - RANG_COUCHE[a.couche ?? 'page'],
  );

  const enSequence = sequenceG > 0 && Date.now() - sequenceG < FENETRE_SEQUENCE_MS;
  sequenceG = 0;

  for (const r of candidats) {
    if (Boolean(r.sequence) !== enSequence) continue;
    if (e.repeat && !r.repetition) continue;
    if (Boolean(r.ctrl) !== ctrl) continue;
    if (dansChamp && !r.dansChamp) continue;
    // L'activation native d'un élément focalisé passe avant un raccourci.
    if (e.key === ' ' && activableEspace) continue;
    if (e.key === 'Enter' && activable) continue;
    if (!correspond(r, e)) continue;
    if (r.action(e) === false) continue;
    e.preventDefault();
    return;
  }

  // Premier temps d'une séquence « g puis… » : seulement si une séquence est inscrite et que rien n'a pris la touche.
  if (!enSequence && !ctrl && !dansChamp && !e.repeat && e.key.toLowerCase() === 'g' && candidats.some((r) => r.sequence === 'g')) {
    sequenceG = Date.now();
    e.preventDefault();
  }
}

/** Pose l'écouteur unique et les raccourcis globaux (aide, recherche, navigation « g puis… »). */
export function FournisseurClavier({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const aller = (destination: string) => {
    if (location.pathname === destination) return;
    if (gardeNavigation) gardeNavigation(destination);
    else router.push(destination);
  };

  useEffect(() => {
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, []);

  useRaccourcis([
    { touche: '?', libelle: 'Afficher les raccourcis', groupe: 'Navigation', couche: 'global', action: () => basculerAide() },
    {
      touche: '/',
      libelle: 'Chercher dans la page',
      groupe: 'Navigation',
      couche: 'global',
      action: () => {
        const champ = recherches.at(-1);
        if (!champ?.isConnected) return false;
        champ.focus();
        champ.select();
      },
    },
    { touche: 'h', sequence: 'g', libelle: 'Aller à l’accueil', groupe: 'Navigation', couche: 'global', action: () => aller('/') },
    { touche: 'e', sequence: 'g', libelle: 'Aller aux entreprises', groupe: 'Navigation', couche: 'global', action: () => aller('/entreprises') },
    { touche: 'a', sequence: 'g', libelle: 'Aller aux appels', groupe: 'Navigation', couche: 'global', action: () => aller('/appels') },
    { touche: 't', sequence: 'g', libelle: 'Aller au téléphone', groupe: 'Navigation', couche: 'global', action: () => aller('/telephone') },
    { touche: 'r', sequence: 'g', libelle: 'Aller aux réglages', groupe: 'Navigation', couche: 'global', action: () => aller('/reglages') },
  ]);

  return <>{children}</>;
}

/* ------------------------------------------------------------------ navigation dans une liste */

const CLE_LISTE = 'autocalled:liste:';

function lireSession(cle: string): string | null {
  try {
    return sessionStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrireSession(cle: string, valeur: string) {
  try {
    sessionStorage.setItem(cle, valeur);
  } catch {
    // stockage indisponible (navigation privée, bloqué) : la liste ne retrouvera pas sa ligne, rien de plus
  }
}

/**
 * Met le focus sur la première ligne d'une liste (NavigationListe) de la page, et la sélectionne. Pour
 * passer du champ de recherche aux résultats par ↓. Renvoie false s'il n'y a aucune ligne.
 */
export function focaliserPremiereLigne(): boolean {
  const lien = document.querySelector<HTMLAnchorElement>('[data-navigation-liste] [data-lien-ligne]');
  if (!lien) return false;
  const racine = lien.closest('[data-navigation-liste]');
  for (const l of racine?.querySelectorAll('[data-selectionnee]') ?? []) l.removeAttribute('data-selectionnee');
  const ligne = lien.closest<HTMLElement>('[data-ligne]') ?? lien;
  ligne.setAttribute('data-selectionnee', '');
  lien.focus({ preventScroll: true });
  ligne.scrollIntoView({ block: 'nearest' });
  return true;
}

/**
 * Enveloppe cliente d'une liste rendue côté serveur : j et k (↓ et ↑ quand le focus est déjà dans la liste)
 * déplacent le focus d'une ligne à l'autre par leurs liens `[data-lien-ligne]` ; Début et Fin vont aux
 * extrémités ; Entrée ouvre (natif). `memoriser` retient la ligne ouverte pour la retrouver au retour.
 */
export function NavigationListe({ children, memoriser }: { children: React.ReactNode; memoriser?: string }) {
  const conteneur = useRef<HTMLDivElement>(null);

  const liens = () => [...(conteneur.current?.querySelectorAll<HTMLAnchorElement>('[data-lien-ligne]') ?? [])];
  const ligneDe = (lien: Element) => lien.closest<HTMLElement>('[data-ligne]') ?? (lien as HTMLElement);
  const dedans = () => Boolean(conteneur.current?.contains(document.activeElement));

  const selectionner = (lien: HTMLAnchorElement | undefined) => {
    if (!lien) return false;
    for (const l of conteneur.current?.querySelectorAll('[data-selectionnee]') ?? []) l.removeAttribute('data-selectionnee');
    const ligne = ligneDe(lien);
    ligne.setAttribute('data-selectionnee', '');
    lien.focus({ preventScroll: true });
    ligne.scrollIntoView({ block: 'nearest' });
  };

  const rang = () => {
    const tous = liens();
    const actif = document.activeElement;
    const i = tous.findIndex((l) => l === actif || l.contains(actif));
    if (i >= 0) return i;
    return tous.findIndex((l) => ligneDe(l).hasAttribute('data-selectionnee'));
  };

  const deplacer = (pas: number) => {
    const tous = liens();
    if (tous.length === 0) return false;
    const i = rang();
    const suivant = i < 0 ? (pas > 0 ? 0 : tous.length - 1) : Math.min(tous.length - 1, Math.max(0, i + pas));
    return selectionner(tous[suivant]);
  };

  useRaccourcis([
    { touche: 'j', libelle: 'Ligne suivante', groupe: 'Liste', repetition: true, action: () => deplacer(1) },
    { touche: 'k', libelle: 'Ligne précédente', groupe: 'Liste', repetition: true, action: () => deplacer(-1) },
    { touche: 'ArrowDown', libelle: 'Ligne suivante', groupe: 'Liste', repetition: true, action: () => dedans() && deplacer(1) },
    { touche: 'ArrowUp', libelle: 'Ligne précédente', groupe: 'Liste', repetition: true, action: () => dedans() && deplacer(-1) },
    { touche: 'Home', libelle: 'Première ligne', groupe: 'Liste', action: () => dedans() && selectionner(liens()[0]) },
    { touche: 'End', libelle: 'Dernière ligne', groupe: 'Liste', action: () => dedans() && selectionner(liens().at(-1)) },
  ]);

  // Retour sur la liste : la ligne ouverte en dernier reprend le focus et revient à l'écran.
  useEffect(() => {
    if (memoriser === undefined) return;
    const cle = `${CLE_LISTE}${memoriser}:${location.pathname}${location.search}`;
    const retenu = lireSession(cle);
    const racine = conteneur.current;
    if (retenu && racine) {
      const lien = [...racine.querySelectorAll<HTMLAnchorElement>('[data-lien-ligne]')].find((l) => l.getAttribute('href') === retenu);
      if (lien) {
        const ligne = lien.closest<HTMLElement>('[data-ligne]') ?? lien;
        ligne.setAttribute('data-selectionnee', '');
        lien.focus({ preventScroll: true });
        ligne.scrollIntoView({ block: 'center' });
      }
    }
    const retenir = (e: Event) => {
      const lien = e.target instanceof Element ? e.target.closest('[data-lien-ligne]') : null;
      if (!lien) return;
      if (e instanceof KeyboardEvent && e.key !== 'Enter') return;
      const href = lien.getAttribute('href');
      if (href) ecrireSession(cle, href);
    };
    racine?.addEventListener('click', retenir);
    racine?.addEventListener('keydown', retenir);
    return () => {
      racine?.removeEventListener('click', retenir);
      racine?.removeEventListener('keydown', retenir);
    };
  }, [memoriser]);

  // Tab dans la liste : la ligne focalisée devient la ligne sélectionnée.
  const surFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const lien = e.target.closest?.('[data-lien-ligne]');
    if (!lien) return;
    for (const l of conteneur.current?.querySelectorAll('[data-selectionnee]') ?? []) l.removeAttribute('data-selectionnee');
    ligneDe(lien).setAttribute('data-selectionnee', '');
  };

  return (
    <div ref={conteneur} onFocus={surFocus} data-navigation-liste="">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ aide */

const NOMS_TOUCHES: Record<string, string> = {
  ' ': 'Espace',
  Enter: 'Entrée',
  Escape: 'Échap',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: 'Début',
  End: 'Fin',
};

/** Ce qu'affiche une Touche pour ce raccourci (« E », « Espace », « ↓ »). */
export function nomTouche(touche: string): string {
  return NOMS_TOUCHES[touche] ?? (touche.length === 1 ? touche.toUpperCase() : touche);
}

/** Valeur d'aria-keyshortcuts pour une touche (« Space », « E », « Control+Enter »). */
export function toucheAria(touche: string, ctrl = false): string {
  const nom = touche === ' ' ? 'Space' : touche.length === 1 ? touche.toUpperCase() : touche;
  return ctrl ? `Control+${nom}` : nom;
}

const ORDRE_GROUPES: GroupeRaccourci[] = ['Appel', 'Liste', 'Page', 'Confirmation', 'Navigation'];

type LigneAide = { cle: string; touches: string[][]; libelle: string };

function lignesAide(entrees: readonly Raccourci[]): { groupe: GroupeRaccourci; lignes: LigneAide[] }[] {
  const parGroupe = new Map<GroupeRaccourci, Map<string, LigneAide>>();
  // Les globaux sont inscrits en premier : ils viennent en dernier ici, groupe Navigation.
  for (const r of entrees) {
    const groupe = r.groupe ?? 'Page';
    const lignes = parGroupe.get(groupe) ?? new Map<string, LigneAide>();
    parGroupe.set(groupe, lignes);
    const touches = r.sequence ? [nomTouche(r.sequence), nomTouche(r.touche)] : [(r.ctrl ? 'Ctrl ' : '') + nomTouche(r.touche)];
    const existante = lignes.get(r.libelle);
    if (existante) {
      if (!existante.touches.some((t) => t.join() === touches.join())) existante.touches.push(touches);
    } else lignes.set(r.libelle, { cle: `${groupe}-${r.libelle}`, touches: [touches], libelle: r.libelle });
  }
  return ORDRE_GROUPES.filter((g) => parGroupe.has(g)).map((g) => ({ groupe: g, lignes: [...parGroupe.get(g)!.values()] }));
}

const NOMS_GROUPES: Record<GroupeRaccourci, string> = {
  Appel: 'Appel en cours',
  Liste: 'Liste',
  Page: 'Cette page',
  Confirmation: 'Confirmation',
  Navigation: 'Partout',
};

/** Panneau non modal des raccourcis actifs, ouvert par « ? » ou par le bouton de la barre. */
export function AideRaccourcis() {
  const { ouverte, entrees } = useAide();
  const panneau = useRef<HTMLDivElement>(null);
  const titre = useId();

  useRaccourcis([
    { touche: 'Escape', libelle: 'Fermer l’aide', couche: 'aide', dansChamp: true, actif: ouverte, action: () => fermerAide() },
    { touche: '?', libelle: 'Fermer l’aide', couche: 'aide', actif: ouverte, action: () => fermerAide() },
  ]);

  useEffect(() => {
    if (ouverte) panneau.current?.focus();
  }, [ouverte]);

  if (!ouverte) return null;
  const groupes = lignesAide(entrees);
  return (
    <div
      ref={panneau}
      id="aide-raccourcis"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titre}
      tabIndex={-1}
      className="fixed top-[calc(var(--hauteur-barre)+8px)] right-(--gouttiere) z-40 max-h-[calc(100dvh-var(--hauteur-barre)-24px)] w-80 max-w-[calc(100vw-2*var(--gouttiere))] overflow-y-auto rounded-md border border-filet-2 bg-surface p-4 shadow-[0_8px_24px_rgb(0_0_0/0.35)] focus:outline-none"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={titre} className="text-md font-semibold">
          Raccourcis clavier
        </h2>
        <span className="flex items-center gap-1.5 text-sm text-encre-3">
          <Touche>Échap</Touche> fermer
        </span>
      </div>
      <div className="mt-3 grid gap-4">
        {groupes.map(({ groupe, lignes }) => (
          <section key={groupe} aria-label={NOMS_GROUPES[groupe]} className="grid gap-1.5">
            <h3 className="text-sm text-encre-3">{NOMS_GROUPES[groupe]}</h3>
            <ul className="grid gap-1.5">
              {lignes.map((l) => (
                <li key={l.cle} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-encre-2">{l.libelle}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {l.touches.map((suite, i) => (
                      <span key={suite.join('+')} className="flex items-center gap-1">
                        {i > 0 ? <span className="text-encre-3">ou</span> : null}
                        {suite.map((t, j) => (
                          <span key={`${t}-${j}`} className="flex items-center gap-1">
                            {j > 0 ? <span className="text-encre-3">puis</span> : null}
                            <Touche>{t}</Touche>
                          </span>
                        ))}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** « ? Raccourcis » dans la barre ; masqué au toucher et sous 640 px (la place va à l'état de la ligne). */
export function BoutonAideRaccourcis() {
  const { ouverte } = useAide();
  return (
    <button
      type="button"
      aria-expanded={ouverte}
      aria-controls={ouverte ? 'aide-raccourcis' : undefined}
      aria-keyshortcuts="?"
      onClick={(e) => basculerAide(e.currentTarget)}
      className="group inline-flex h-9 items-center gap-2 rounded-[4px] px-1.5 text-md whitespace-nowrap text-encre-3 transition-colors duration-150 hover:text-encre-2 max-sm:hidden pointer-coarse:hidden"
    >
      <Touche decorative>?</Touche>
      <span className="decoration-souligne decoration-1 underline-offset-4 group-hover:underline">Raccourcis</span>
    </button>
  );
}
