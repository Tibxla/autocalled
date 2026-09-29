'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { raccrocherAppelTelephone, relancerAnalyse } from '@/app/appels/actions';
import { usePriseDeMain, type EtatPrise } from '@/app/appels/[id]/prise-de-main';
import { Action, LienAction } from './action';
import { toucheAria, useRaccourcis } from './clavier';
import { Confirmation, useConfirmation } from './confirmation';
import { chrono as formatChrono, heure, numeroMasque, prenom } from './format-appel';
import { useHorloge } from './horloge';

/**
 * Bande d'un appel téléphone en cours, commune à l'accueil, à la fiche d'appel et à la régie de campagne.
 *
 * Limite assumée : le direct (flux SSE, écoute, prise de main, raccrochage) ne se teste pas sans lancer un
 * vrai appel. La logique de flux de useFilAppel et useEcoute est donc COPIÉE de
 * src/app/appels/[id]/suivi-telephone.tsx ; seuls s'y ajoutent l'heure de réception des tours, l'heure de mise
 * en ligne observée, l'erreur et le niveau de l'écoute, et l'arrêt des écoutes des autres onglets.
 * VueBandeAppel est pure : ses états se vérifient sur une page de démonstration.
 */

export interface TourDirect {
  role: 'agent' | 'prospect';
  texte: string;
  recuLe: number;
}

/* ------------------------------------------------------------------ fil de l'appel */

export function useFilAppel(
  appelId: string,
  { suivre, onTermine }: { suivre: boolean; onTermine?: () => void },
): { etat: string; tours: TourDirect[]; perdu: boolean; termineLe: number | null; enLigneDepuis: number | null } {
  const router = useRouter();
  const [etat, setEtat] = useState('composition');
  const [tours, setTours] = useState<TourDirect[]>([]);
  const [perdu, setPerdu] = useState(false);
  const [termineLe, setTermineLe] = useState<number | null>(null);
  const [enLigneDepuis, setEnLigneDepuis] = useState<number | null>(null);
  const surTermine = useRef(onTermine);
  useEffect(() => {
    surTermine.current = onTermine;
  });

  useEffect(() => {
    if (!suivre) return;
    const source = new EventSource(`/appels/${appelId}/direct`);
    // L'historique est rejoué d'un coup à la connexion : « active » n'est une mise en ligne observée que si
    // l'état précédent est resté affiché au moins une seconde.
    let affichageDepuis = Date.now();
    let activeVu = false;
    source.onmessage = (m) => {
      const e = JSON.parse(m.data) as { type: string; etat?: string; role?: TourDirect['role']; texte?: string };
      if (e.type === 'etat' && e.etat) {
        const maintenant = Date.now();
        if (e.etat === 'active' && !activeVu) {
          activeVu = true;
          setEnLigneDepuis(maintenant - affichageDepuis >= 1000 ? maintenant : null);
        }
        affichageDepuis = maintenant;
        setEtat(e.etat);
        if (e.etat === 'termine') {
          source.close();
          setTermineLe(maintenant);
          if (surTermine.current) surTermine.current();
          else router.refresh();
        }
      } else if (e.type === 'tour' && e.role && e.texte?.trim()) {
        const tour = { role: e.role, texte: e.texte, recuLe: Date.now() };
        setTours((t) => [...t, tour]);
      }
    };
    // Coupure passagère : EventSource se reconnecte seul et reprend après le dernier événement reçu.
    // Refus définitif (le pont ne connaît plus l'appel, terminé entre-temps) : la page affichera le bilan.
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return;
      setPerdu(true);
      router.refresh();
    };
    return () => source.close();
  }, [appelId, router, suivre]);

  return { etat, tours, perdu, termineLe, enLigneDepuis };
}

/* ------------------------------------------------------------------ écoute */

/** Retard ajouté à l'écoute pour absorber les à-coups du réseau (en secondes). */
const TAMPON_ECOUTE = 0.4;
const CANAL_DIRECT = 'autocalled-direct';
const ERREUR_ECOUTE = 'Écoute impossible : la ligne ne relaie pas le son de cet appel.';

/**
 * Écoute en direct : lit le flux PCM relayé par l'application et le programme dans WebAudio par
 * morceaux de 100 ms. Une à deux secondes de retard sur l'appel. Une seule écoute à la fois : en démarrer
 * une arrête celles des autres onglets.
 */
export function useEcoute(appelId: string): {
  active: boolean;
  erreur: string | null;
  demarrer: () => Promise<void>;
  arreter: () => void;
  niveau: () => number;
} {
  const [active, setActive] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const arret = useRef<(() => void) | null>(null);
  const niveauCourant = useRef(0);
  const canal = useRef<BroadcastChannel | null>(null);

  const arreter = useCallback(() => {
    arret.current?.();
    arret.current = null;
    niveauCourant.current = 0;
    setActive(false);
  }, []);

  useEffect(() => {
    let c: BroadcastChannel | null = null;
    try {
      c = new BroadcastChannel(CANAL_DIRECT);
      c.onmessage = (m: MessageEvent<{ type?: string }>) => {
        if (m.data?.type === 'ecoute' && arret.current) arreter();
      };
      canal.current = c;
    } catch {
      // BroadcastChannel absent : chaque onglet garde sa propre écoute
    }
    return () => {
      c?.close();
      canal.current = null;
    };
  }, [arreter]);

  const demarrer = useCallback(async () => {
    try {
      canal.current?.postMessage({ type: 'ecoute' });
    } catch {
      // canal fermé : sans conséquence
    }
    setErreur(null);
    const controleur = new AbortController();
    const contexte = new AudioContext();
    arret.current = () => {
      controleur.abort();
      void contexte.close();
    };
    setActive(true);
    try {
      const r = await fetch(`/appels/${appelId}/ecoute`, { signal: controleur.signal, cache: 'no-store' });
      if (!r.ok || !r.body) {
        setErreur(ERREUR_ECOUTE);
        throw new Error();
      }
      const taux = Number(r.headers.get('x-taux')) || 16000;
      const lecteur = r.body.getReader();
      const parMorceau = Math.round(taux / 10);
      let reste = new Uint8Array(0);
      let echantillons: number[] = [];
      let prochain = 0;
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        const octets = new Uint8Array(reste.length + value.length);
        octets.set(reste);
        octets.set(value, reste.length);
        const pairs = octets.length - (octets.length % 2);
        const vue = new DataView(octets.buffer, 0, pairs);
        for (let i = 0; i < pairs; i += 2) echantillons.push(vue.getInt16(i, true) / 32768);
        reste = octets.slice(pairs);
        while (echantillons.length >= parMorceau) {
          const morceau = echantillons.slice(0, parMorceau);
          echantillons = echantillons.slice(parMorceau);
          // Niveau du dernier morceau décodé (RMS), lu par la piste de parole : rien ne change dans le graphe audio.
          let somme = 0;
          for (const x of morceau) somme += x * x;
          niveauCourant.current = Math.sqrt(somme / morceau.length);
          const tampon = contexte.createBuffer(1, morceau.length, taux);
          tampon.copyToChannel(Float32Array.from(morceau), 0);
          const source = contexte.createBufferSource();
          source.buffer = tampon;
          source.connect(contexte.destination);
          prochain = Math.max(prochain, contexte.currentTime + TAMPON_ECOUTE);
          source.start(prochain);
          prochain += tampon.duration;
        }
      }
    } catch {
      // arrêt demandé (AbortError), appel terminé, ou refus déjà signalé
    }
    arreter();
  }, [appelId, arreter]);

  useEffect(() => () => arret.current?.(), []);
  const niveau = useCallback(() => niveauCourant.current, []);
  return { active, erreur, demarrer, arreter, niveau };
}

/* ------------------------------------------------------------------ textes */

const LIBELLES_ETAT: Record<string, string> = {
  composition: 'Composition…',
  dialing: 'Composition…',
  alerting: 'Ça sonne',
  active: 'En ligne',
  reconnexion: 'Pas de son : reconnexion du téléphone…',
  disconnected: 'Raccroché',
  'prise-en-main': 'Main reprise : Mina s’est tue',
  termine: 'Appel terminé : rapatriement et analyse…',
};

const SONNE = new Set(['composition', 'dialing', 'alerting']);
const EN_LIGNE = new Set(['active', 'prise-en-main']);

/** La phrase de Mina en sous-titre : dernière phrase du dernier tour, jointe à la précédente si elle est courte. */
export function phraseDeMina(texte: string): { phrase: string; taille: 'grande' | 'moyenne' } {
  const phrases = (texte.match(/[^.!?…]+[.!?…]*/g) ?? [texte]).map((p) => p.trim()).filter(Boolean);
  let phrase = phrases.at(-1) ?? texte.trim();
  if (phrase.length < 25 && phrases.length > 1) phrase = `${phrases.at(-2)} ${phrase}`;
  if (phrase.length <= 68) return { phrase, taille: 'grande' };
  if (phrase.length <= 110) return { phrase, taille: 'moyenne' };
  const fin = phrase.slice(-110);
  const coupe = fin.indexOf(' ');
  return { phrase: `…${coupe >= 0 ? fin.slice(coupe + 1) : fin}`, taille: 'moyenne' };
}

/** Garde la fin d'un texte (« … » et les `n` derniers caractères, coupés sur un mot). */
function fin(texte: string, n: number): string {
  const propre = texte.trim();
  if (propre.length <= n) return propre;
  const bout = propre.slice(-n);
  const coupe = bout.indexOf(' ');
  return `…${coupe >= 0 ? bout.slice(coupe + 1) : bout}`;
}

/* ------------------------------------------------------------------ piste de parole */

const LARGEUR_BARRE = 2;
const PAS_BARRE = 4;
const ECART_SEGMENT = 6;
const MOTS_PAR_SECONDE = 2.6;

/**
 * L'onde honnête : le pont n'envoie aucun niveau audio par voix, seulement des états et des tours. Chaque tour
 * devient un segment, une barre par mot, dont la hauteur suit la longueur du mot : Mina au-dessus de l'axe en
 * antenne, le prospect dessous. La dernière réplique de Mina s'anime pendant sa durée estimée, puis se fige ;
 * pendant l'écoute, elle suit le niveau du son (une seule piste : le flux mélange les deux voix).
 */
export function PisteParole({ tours, niveau, actif, hauteur = 40 }: { tours: TourDirect[]; niveau?: () => number; actif: boolean; hauteur?: number }) {
  const cadre = useRef<HTMLDivElement>(null);
  const derniere = useRef<SVGGElement>(null);
  const [largeur, setLargeur] = useState(0);
  const maintenant = useHorloge(actif);

  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const observateur = new ResizeObserver(([entree]) => setLargeur(Math.floor(entree?.contentRect.width ?? 0)));
    observateur.observe(el);
    return () => observateur.disconnect();
  }, []);

  const avecNiveau = Boolean(niveau) && actif;
  useEffect(() => {
    const g = derniere.current;
    if (!avecNiveau || !niveau || !g) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let image = 0;
    const suivre = () => {
      g.style.transform = `scaleY(${0.35 + 0.65 * Math.min(1, niveau() * 4)})`;
      image = requestAnimationFrame(suivre);
    };
    suivre();
    return () => {
      cancelAnimationFrame(image);
      g.style.transform = '';
    };
  }, [avecNiveau, niveau]);

  const milieu = hauteur / 2;
  const echelle = (milieu - 1) / 19;

  // Segments du plus récent au plus ancien, tant que la largeur le permet.
  type Segment = { tour: TourDirect; index: number; mots: number[] };
  const retenus: Segment[] = [];
  let place = largeur;
  for (let i = tours.length - 1; i >= 0 && place > 0; i--) {
    const tour = tours[i]!;
    const mots = tour.texte.split(/\s+/).filter(Boolean).map((m) => Math.min(19, Math.max(3, Math.round(1 + m.length * 1.6))));
    const utile = mots.length * PAS_BARRE - (PAS_BARRE - LARGEUR_BARRE);
    if (utile + ECART_SEGMENT > place && retenus.length > 0) break;
    retenus.unshift({ tour, index: i, mots });
    place -= utile + ECART_SEGMENT;
  }
  const dernierMina = tours.findLastIndex((t) => t.role === 'agent');
  const minaParle =
    actif && dernierMina >= 0 && maintenant > 0 && maintenant - tours[dernierMina]!.recuLe < (tours[dernierMina]!.texte.split(/\s+/).length / MOTS_PAR_SECONDE) * 1000;

  let x = 0;
  return (
    <div ref={cadre} aria-hidden="true" className="w-full min-w-0 overflow-hidden">
      <svg width="100%" height={hauteur} viewBox={`0 0 ${largeur || 1} ${hauteur}`} preserveAspectRatio="none" className="block max-sm:h-8">
        <rect x="0" y={milieu - 0.5} width={largeur} height="1" className="fill-filet-2" />
        {retenus.map((s) => {
          const debut = x;
          x += s.mots.length * PAS_BARRE - (PAS_BARRE - LARGEUR_BARRE) + ECART_SEGMENT;
          const mina = s.tour.role === 'agent';
          const vivant = mina && s.index === dernierMina && actif;
          return (
            <g
              key={s.index}
              ref={vivant ? derniere : undefined}
              className={mina ? 'fill-antenne' : 'fill-encre-3'}
              style={vivant ? { transformBox: 'fill-box', transformOrigin: '50% 100%' } : undefined}
            >
              {s.mots.map((h, j) => {
                const hh = h * echelle;
                return (
                  <rect
                    key={j}
                    x={debut + j * PAS_BARRE}
                    y={mina ? milieu - 1 - hh : milieu + 1}
                    width={LARGEUR_BARRE}
                    height={hh}
                    className={vivant && minaParle && !avecNiveau ? 'anime-parole [transform-box:fill-box]' : undefined}
                    style={vivant && minaParle && !avecNiveau ? { animationDelay: `${((j * 0.13) % 0.8).toFixed(2)}s` } : undefined}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ vue */

export interface IdentiteAppel {
  prospect: string;
  societe?: string | null;
  entreprise?: string | null;
  version?: string | null;
  numeroMasque?: string | null;
  lien?: string | null;
}

export interface VueBandeAppelProps {
  /** bande : fil replié (T) ; fiche : fil déplié. */
  variante: 'bande' | 'fiche';
  /** Absente sur la fiche d'appel, qui l'affiche dans son en-tête. */
  identite?: IdentiteAppel;
  etat: string;
  perdu: boolean;
  tours: TourDirect[];
  chrono: { libelle: string; depuis: number } | null;
  ecoute: { active: boolean; erreur: string | null; niveau?: () => number };
  prise: { etat: EtatPrise; erreur: string | null; muet: boolean; depuis?: number | null };
  raccrochage: { enCours: boolean; erreur: string | null };
  /** Statut traitement : fil figé, contrôles retirés. */
  termine?: { le: number } | null;
  conversation?: boolean;
  /** Remplace les actions téléphone (ligne navigateur). */
  actions?: React.ReactNode;
  /** Remplace la piste de parole (ligne navigateur : OndeDirect). */
  onde?: React.ReactNode;
  /** Défaut : prénom du prospect ; « Toi (prospect) » sur la ligne navigateur. */
  libelleProspect?: string;
  onEcouter: () => void;
  onArreterEcoute: () => void;
  onPrendreLaMain: () => void;
  onBasculerMicro: () => void;
  onRaccrocher: () => Promise<void> | void;
  onRapatrier?: () => void;
  rapatriementEnCours?: boolean;
  /** Défaut vrai ; une seule bande par page inscrit E, Espace, M, T. */
  raccourcis?: boolean;
  /** Accueil : version collante quand la bande sort de l'écran. */
  condensee?: boolean;
  /** Démonstration : une confirmation déjà ouverte. */
  confirmationInitiale?: 'prise' | 'raccrochage' | null;
  /** Fil perdu mais appel encore « en cours » en base : Raccrocher reste proposé (le pont a pu redémarrer). */
  raccrochageSiPerdu?: boolean;
}

function Chrono({ chrono, maintenant, enLigne, etat }: { chrono: VueBandeAppelProps['chrono']; maintenant: number; enLigne: boolean; etat: string }) {
  if (!chrono) return null;
  // « En ligne en ligne 00:42 » : le libellé du chrono se tait quand il répète l'état.
  const repete = chrono.libelle === 'en ligne' && etat === 'active';
  return (
    <span className="text-sm whitespace-nowrap text-encre-3">
      {repete ? <span className="sr-only">{chrono.libelle} </span> : `${chrono.libelle} `}
      <span className={`font-mono text-base ${enLigne ? 'text-antenne' : 'text-encre-3'}`}>
        {maintenant > 0 ? formatChrono(maintenant - chrono.depuis) : '--:--'}
      </span>
    </span>
  );
}

export function VueBandeAppel({
  variante,
  identite,
  etat: etatFil,
  perdu,
  tours,
  chrono,
  ecoute,
  prise,
  raccrochage,
  termine = null,
  conversation = false,
  actions,
  onde,
  libelleProspect,
  onEcouter,
  onArreterEcoute,
  onPrendreLaMain,
  onBasculerMicro,
  onRaccrocher,
  onRapatrier,
  rapatriementEnCours = false,
  raccourcis = true,
  condensee = false,
  confirmationInitiale = null,
  raccrochageSiPerdu = false,
}: VueBandeAppelProps) {
  const etat = termine ? 'termine' : etatFil;
  const enLigne = !termine && !perdu && etat !== 'termine' && etat !== 'disconnected';
  const vivant = enLigne && EN_LIGNE.has(etat);
  const maintenant = useHorloge(Boolean(chrono) || prise.etat === 'active');
  const nomProspect = libelleProspect ?? (identite ? prenom(identite.prospect) : 'Prospect');

  const confirmationPrise = useConfirmation();
  const confirmationRaccrochage = useConfirmation();
  const [ouverteAuDepart, setOuverteAuDepart] = useState(confirmationInitiale);
  const priseOuverte = confirmationPrise.ouverte || ouverteAuDepart === 'prise';
  const raccrochageOuvert = confirmationRaccrochage.ouverte || ouverteAuDepart === 'raccrochage';
  const fermerPrise = () => {
    setOuverteAuDepart(null);
    confirmationPrise.fermer();
  };
  const fermerRaccrochage = () => {
    setOuverteAuDepart(null);
    confirmationRaccrochage.fermer();
  };

  const [filOuvert, setFilOuvert] = useState(variante === 'fiche');
  const boutonPrise = useRef<HTMLButtonElement>(null);
  const boutonRaccrocher = useRef<HTMLButtonElement>(null);

  const telephone = !actions;
  const voirEcoute = telephone && enLigne && prise.etat !== 'active' && prise.etat !== 'connexion';
  const voirPrise = telephone && enLigne && EN_LIGNE.has(etat) && (prise.etat === 'repos' || prise.etat === 'erreur');
  const voirMicro = telephone && enLigne && prise.etat === 'active';
  const voirRaccrocher = telephone && enLigne;
  const raccrocherPerdu = telephone && perdu && !termine && raccrochageSiPerdu;

  const basculerEcoute = () => (ecoute.active ? onArreterEcoute() : onEcouter());
  const ouvrirPrise = () => confirmationPrise.ouvrir(boutonPrise.current);
  const ouvrirRaccrochage = () => confirmationRaccrochage.ouvrir(boutonRaccrocher.current);

  useRaccourcis([
    { touche: 'e', libelle: ecoute.active ? 'Arrêter l’écoute' : 'Écouter', groupe: 'Appel', actif: raccourcis && voirEcoute, action: basculerEcoute },
    { touche: ' ', libelle: 'Prendre la main', groupe: 'Appel', actif: raccourcis && voirPrise && !priseOuverte, action: ouvrirPrise },
    { touche: 'm', libelle: prise.muet ? 'Réactiver mon micro' : 'Couper mon micro', groupe: 'Appel', actif: raccourcis && voirMicro, action: onBasculerMicro },
    {
      touche: 't',
      libelle: filOuvert ? 'Replier le fil' : 'Déplier le fil',
      groupe: 'Appel',
      actif: raccourcis && variante === 'bande' && tours.length > 0,
      action: () => setFilOuvert((o) => !o),
    },
  ]);

  // Version condensée : collée sous la barre quand la bande est sortie de l'écran par le haut.
  const bande = useRef<HTMLElement>(null);
  const [horsEcran, setHorsEcran] = useState(false);
  useEffect(() => {
    const el = bande.current;
    if (!condensee || !el) return;
    const observateur = new IntersectionObserver(([e]) => setHorsEcran(Boolean(e && !e.isIntersecting && e.boundingClientRect.top < 0)));
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [condensee]);

  // Sous-titre : la dernière réplique de Mina, et celle du prospect qui la précède.
  const iMina = tours.findLastIndex((t) => t.role === 'agent');
  const tourMina = iMina >= 0 ? tours[iMina] : undefined;
  const tourProspect = tours.slice(0, iMina >= 0 ? iMina : tours.length).findLast((t) => t.role === 'prospect');
  const sousTitre = tourMina ? phraseDeMina(tourMina.texte) : null;
  const dernierTour = tours.at(-1);

  const texteEtat = LIBELLES_ETAT[etat] ?? etat;
  const couleurEtat = vivant || prise.etat === 'active' ? 'text-antenne' : 'text-encre-3';

  const boutons = telephone ? (
    <div className="-mx-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:[&_.touche]:hidden max-sm:[&>button]:h-11 max-sm:[&>button]:justify-center">
      {voirEcoute ? (
        <Action
          touche="E"
          aria-keyshortcuts={raccourcis ? toucheAria('e') : undefined}
          onClick={basculerEcoute}
          // Un clic souris ne laisse pas le focus ici : Espace (prendre la main) ne recliquerait pas l'écoute.
          onMouseDown={(e) => e.preventDefault()}
          aria-pressed={ecoute.active}
        >
          {ecoute.active ? 'Arrêter l’écoute' : 'Écouter'}
        </Action>
      ) : null}
      {voirPrise ? (
        <Action ref={boutonPrise} ton="fort" touche="Espace" aria-keyshortcuts={raccourcis ? toucheAria(' ') : undefined} onClick={ouvrirPrise} aria-expanded={priseOuverte}>
          Prendre la main
        </Action>
      ) : null}
      {voirMicro ? (
        <Action
          touche="M"
          aria-keyshortcuts={raccourcis ? toucheAria('m') : undefined}
          onClick={onBasculerMicro}
          onMouseDown={(e) => e.preventDefault()}
          aria-pressed={prise.muet}
        >
          {prise.muet ? 'Réactiver mon micro' : 'Couper mon micro'}
        </Action>
      ) : null}
      {voirRaccrocher ? (
        <Action ref={boutonRaccrocher} ton="alerte" className="sm:ml-6" onClick={ouvrirRaccrochage} aria-expanded={raccrochageOuvert}>
          Raccrocher
        </Action>
      ) : null}
    </div>
  ) : (
    actions
  );

  return (
    <>
      <section ref={bande} aria-label="Appel en cours" className="grid min-w-0 grid-cols-1 gap-3.5">
        {/* Rangée 1 : qui, où en est l'appel, les gestes. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {identite ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
              {identite.lien ? (
                <Link href={identite.lien} className="text-lg font-semibold decoration-souligne underline-offset-4 hover:underline">
                  {identite.prospect}
                </Link>
              ) : (
                <span className="text-lg font-semibold">{identite.prospect}</span>
              )}
              <span className="min-w-0 text-md text-encre-3">
                {[identite.societe, identite.entreprise, identite.version].filter(Boolean).join(' · ')}
                {identite.numeroMasque ? (
                  <>
                    {identite.societe || identite.entreprise || identite.version ? ' · ' : ''}
                    <span className="font-mono">{numeroMasque(identite.numeroMasque)}</span>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:w-full">
            <span className={`text-sm ${couleurEtat}`}>{texteEtat}</span>
            <Chrono chrono={chrono} maintenant={maintenant} enLigne={vivant} etat={etat} />
            {termine ? null : boutons}
          </div>
        </div>

        {/* Confirmations et messages, dans le flux, sous les gestes. */}
        {voirPrise || priseOuverte ? (
          <Confirmation
            ouverte={priseOuverte && enLigne}
            question={`Prendre la main sur l’appel de ${nomProspect} ?`}
            libelleConfirmer="Prendre la main"
            onConfirmer={() => {
              fermerPrise();
              onPrendreLaMain();
            }}
            onAnnuler={fermerPrise}
          >
            Mina se tait tout de suite et ne reprendra pas : tu termines l’appel toi-même, avec ton micro. Annonce-toi (« Thibaud à l’appareil, je
            prends le relais »). Mets un casque : sans lui, ton micro reprend la voix du prospect. La transcription et le bilan s’arrêtent au relais.
          </Confirmation>
        ) : null}
        <Confirmation
          ouverte={raccrochageOuvert && (enLigne || raccrocherPerdu)}
          question={`Raccrocher l’appel de ${nomProspect} ?`}
          libelleConfirmer="Raccrocher"
          libelleAnnuler="Continuer l’appel"
          ton="alerte"
          enCours={raccrochage.enCours}
          libelleEnCours="Raccrochage…"
          erreur={raccrochage.erreur}
          onConfirmer={() => onRaccrocher()}
          onAnnuler={fermerRaccrochage}
        >
          La conversation s’arrête pour le prospect.
        </Confirmation>
        {prise.etat === 'connexion' ? <p className="text-sm text-encre-3">Connexion au téléphone…</p> : null}
        {prise.etat === 'active' ? (
          <p className="text-sm text-antenne">
            {prise.muet
              ? 'Tu as la main, micro coupé.'
              : prise.depuis && maintenant > 0
                ? `Tu as la main depuis ${formatChrono(maintenant - prise.depuis)} : le prospect t’entend.`
                : 'Tu as la main : le prospect t’entend.'}
          </p>
        ) : null}
        {prise.erreur ? (
          <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
            {prise.erreur}
          </p>
        ) : null}
        {ecoute.active ? <p className="text-sm text-encre-3">Écoute en direct, une à deux secondes de retard. Personne ne t’entend.</p> : null}
        {ecoute.erreur ? (
          <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
            {ecoute.erreur}
          </p>
        ) : null}
        {raccrochage.erreur && !raccrochageOuvert ? (
          <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
            {raccrochage.erreur}
          </p>
        ) : null}
        {perdu ? (
          <div role="status" className="grid justify-items-start gap-1.5 rounded-md bg-surface px-3.5 py-3 text-sm text-encre-2">
            <p>Le fil de cet appel ne répond plus (ligne arrêtée ou redémarrée).</p>
            {!conversation ? <p className="text-encre-3">Rien à rapatrier : la conversation n’a pas été ouverte.</p> : null}
            {raccrocherPerdu ? <p>Si le téléphone sonne encore, raccroche d’ici.</p> : null}
            <div className="-mx-1.5 flex flex-wrap gap-x-4">
              {raccrocherPerdu ? (
                <Action ref={boutonRaccrocher} ton="alerte" onClick={ouvrirRaccrochage} aria-expanded={raccrochageOuvert}>
                  Raccrocher
                </Action>
              ) : null}
              {conversation && onRapatrier ? (
                <Action ton="fort" onClick={onRapatrier} enCours={rapatriementEnCours} libelleEnCours="Rapatriement…" disabled={rapatriementEnCours}>
                  Rapatrier la conversation et le bilan
                </Action>
              ) : null}
              <LienAction href="/telephone">Voir la ligne</LienAction>
            </div>
          </div>
        ) : null}

        {/* Rangée 2 : sous-titre, la dernière phrase de Mina (bande seulement). */}
        {variante === 'bande' && (tours.length > 0 || enLigne) ? (
          <div className="flex min-h-[84px] flex-col items-center justify-end gap-1.5 pt-1.5 pb-0.5 text-center max-sm:min-h-0">
            {tourProspect ? (
              <p aria-hidden="true" className="max-w-full truncate text-lg text-encre-2">
                <span className="mr-2.5 text-md font-semibold text-encre-3">{nomProspect}</span>
                {fin(tourProspect.texte, 90)}
              </p>
            ) : null}
            {sousTitre ? (
              <p
                aria-hidden="true"
                className={`font-medium tracking-[-0.01em] text-balance max-sm:line-clamp-3 max-sm:text-xl ${
                  sousTitre.taille === 'grande' ? 'max-w-[34ch] text-3xl' : 'max-w-[48ch] text-2xl'
                }`}
              >
                <span className="mr-3.5 align-middle text-lg leading-none font-semibold tracking-normal text-antenne">Mina</span>
                {sousTitre.phrase}
              </p>
            ) : null}
          </div>
        ) : null}
        <p aria-live="polite" className="sr-only">
          {dernierTour ? `${dernierTour.role === 'agent' ? 'Mina' : nomProspect} : ${dernierTour.texte}` : ''}
        </p>

        {/* Rangée 3 : la piste de parole, ou l'onde de la ligne navigateur. */}
        {onde ?? (tours.length > 0 || enLigne ? <PisteParole tours={tours} actif={enLigne} {...(ecoute.active && ecoute.niveau ? { niveau: ecoute.niveau } : {})} /> : null)}

        {/* Fil complet : toujours sur la fiche, avec T sur la bande. */}
        {filOuvert && tours.length > 0 ? <Fil tours={tours} nomProspect={nomProspect} /> : null}
      </section>

      {condensee && horsEcran ? (
        <div className="fixed inset-x-0 top-(--hauteur-barre) z-20 flex h-11 items-center gap-4 border-b border-filet bg-fond px-(--gouttiere) text-md">
          <span className="min-w-0 truncate font-semibold max-sm:max-w-[6rem]">{identite?.prospect ?? nomProspect}</span>
          <span className={`shrink-0 text-sm max-sm:hidden ${couleurEtat}`}>{texteEtat}</span>
          <span className="max-sm:hidden">
            <Chrono chrono={chrono} maintenant={maintenant} enLigne={vivant} etat={etat} />
          </span>
          <span className="min-w-0 flex-1 truncate text-encre-2 max-sm:hidden">{tourMina ? fin(tourMina.texte, 60) : ''}</span>
          {termine ? null : (
            <div className="-mr-1.5 ml-auto flex shrink-0 items-center gap-1 max-sm:[&_.touche]:hidden">
              {voirEcoute ? (
                <Action touche="E" onClick={basculerEcoute} className="h-8 max-sm:hidden">
                  {ecoute.active ? 'Arrêter l’écoute' : 'Écouter'}
                </Action>
              ) : null}
              {voirPrise ? (
                <Action ton="fort" touche="Espace" onClick={ouvrirPrise} className="h-8">
                  Prendre la main
                </Action>
              ) : null}
              {voirRaccrocher ? (
                <Action ton="alerte" onClick={ouvrirRaccrochage} className="h-8">
                  Raccrocher
                </Action>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

/** Le fil complet : défile dans son conteneur seulement, et seulement si l'opérateur était déjà en bas. */
function Fil({ tours, nomProspect }: { tours: TourDirect[]; nomProspect: string }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [decroche, setDecroche] = useState<number | null>(null);
  const id = useId();

  useEffect(() => {
    const el = conteneur.current;
    if (el && decroche === null) el.scrollTop = el.scrollHeight;
  }, [tours.length, decroche]);

  const surDefilement = () => {
    const el = conteneur.current;
    if (!el) return;
    const enBas = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setDecroche((d) => (enBas ? null : (d ?? tours.length)));
  };

  return (
    <div className="relative">
      <div ref={conteneur} onScroll={surDefilement} className="max-h-[28rem] overflow-y-auto border-t border-filet pt-3" id={id}>
        <ol className="grid gap-2.5" aria-label="Fil de l’appel">
          {tours.map((t, i) => (
            <li key={i} className="grid gap-x-3 sm:grid-cols-[5rem_1fr]">
              <span className={`text-md font-semibold ${t.role === 'agent' ? 'text-antenne' : 'text-encre'}`}>{t.role === 'agent' ? 'Mina' : nomProspect}</span>
              <p className="max-w-[68ch] text-base text-encre-2">{t.texte}</p>
            </li>
          ))}
        </ol>
      </div>
      {decroche !== null && tours.length > decroche ? (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <Action
            ton="discret"
            className="bg-fond"
            aria-controls={id}
            onClick={() => {
              const el = conteneur.current;
              if (el) el.scrollTop = el.scrollHeight;
              setDecroche(null);
            }}
          >
            ↓ Nouvelles répliques
          </Action>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ bande branchée */

/**
 * Crochets + vue. Le consommateur la rend à la même place et avec la clé appelId pour les statuts en-cours
 * puis traitement : React garde le fil pendant le rapatriement. Chargée directement en traitement, elle ne se
 * connecte pas et n'affiche que l'identité et l'heure de fin.
 */
export function BandeAppel({
  appelId,
  variante,
  identite,
  debutLe,
  statut = 'en-cours',
  finLe,
  conversation = false,
  raccourcis = true,
  condensee = false,
  onTermine,
  libelleProspect,
}: {
  appelId: string;
  variante: 'bande' | 'fiche';
  identite?: IdentiteAppel;
  /** Nom de qui parle côté prospect quand `identite` manque (fiche d'appel) : sinon « Prospect ». */
  libelleProspect?: string;
  debutLe?: string;
  statut?: 'en-cours' | 'traitement';
  finLe?: string | null;
  conversation?: boolean;
  raccourcis?: boolean;
  condensee?: boolean;
  onTermine?: () => void;
}) {
  const fil = useFilAppel(appelId, { suivre: statut === 'en-cours', ...(onTermine ? { onTermine } : {}) });
  const ecoute = useEcoute(appelId);
  const prise = usePriseDeMain(appelId);
  const maintenant = useHorloge(prise.etat === 'active');
  const [raccrochageEnCours, setRaccrochageEnCours] = useState(false);
  const [erreurRaccrochage, setErreurRaccrochage] = useState<string | null>(null);
  const [rapatriementEnCours, rapatrier] = useTransition();

  // Heure à laquelle la main a été prise (à la seconde, par l'horloge partagée).
  const [priseVue, setPriseVue] = useState<EtatPrise>(prise.etat);
  const [priseDepuis, setPriseDepuis] = useState<number | null>(null);
  if (prise.etat !== priseVue) {
    setPriseVue(prise.etat);
    setPriseDepuis(prise.etat === 'active' ? maintenant || null : null);
  }
  if (prise.etat === 'active' && priseDepuis === null && maintenant > 0) setPriseDepuis(maintenant);

  const finConnue = finLe ? Date.parse(finLe) : fil.termineLe;
  const termine = statut === 'traitement' || fil.etat === 'termine' ? { le: finConnue ?? 0 } : null;

  let chrono: VueBandeAppelProps['chrono'] = null;
  if (termine && finConnue) chrono = { libelle: `terminé à ${heure(new Date(finConnue))} · analyse`, depuis: finConnue };
  else if (!termine && SONNE.has(fil.etat) && debutLe) chrono = { libelle: 'sonne depuis', depuis: Date.parse(debutLe) };
  else if (!termine && fil.enLigneDepuis) chrono = { libelle: 'en ligne', depuis: fil.enLigneDepuis };
  else if (!termine && debutLe) chrono = { libelle: 'depuis la composition', depuis: Date.parse(debutLe) };

  return (
    <VueBandeAppel
      variante={variante}
      {...(identite ? { identite } : {})}
      {...(libelleProspect ? { libelleProspect } : {})}
      etat={fil.etat}
      perdu={fil.perdu}
      tours={fil.tours}
      chrono={chrono}
      ecoute={{ active: ecoute.active, erreur: ecoute.erreur, niveau: ecoute.niveau }}
      prise={{ etat: prise.etat, erreur: prise.erreur, muet: prise.muet, depuis: priseDepuis }}
      raccrochage={{ enCours: raccrochageEnCours, erreur: erreurRaccrochage }}
      termine={termine}
      conversation={conversation}
      raccourcis={raccourcis}
      condensee={condensee}
      raccrochageSiPerdu={statut === 'en-cours'}
      rapatriementEnCours={rapatriementEnCours}
      onEcouter={() => void ecoute.demarrer()}
      onArreterEcoute={ecoute.arreter}
      onPrendreLaMain={() => {
        // Ordre actuel : l'écoute s'arrête avant que le micro ne parte vers le téléphone.
        ecoute.arreter();
        void prise.demarrer();
      }}
      onBasculerMicro={prise.basculerMuet}
      onRaccrocher={async () => {
        setErreurRaccrochage(null);
        setRaccrochageEnCours(true);
        const r = await raccrocherAppelTelephone(appelId);
        if (!r.ok) {
          setErreurRaccrochage(r.raison);
          setRaccrochageEnCours(false);
        }
      }}
      onRapatrier={() => rapatrier(() => relancerAnalyse(appelId))}
    />
  );
}
