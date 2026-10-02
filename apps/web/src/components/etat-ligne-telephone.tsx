'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useEtatLigne } from '@/lib/etat-ligne';

/**
 * État de la ligne pour tout l'onglet : UN seul sondage GET /ligne/etat toutes les 3 s, quel que soit le
 * nombre de composants qui l'écoutent (barre, marque, titre, accueil, page Téléphone). Démarré au premier
 * abonné, arrêté au dernier, suspendu onglet caché, relevé tout de suite au retour. La ligne navigateur
 * (connue de la page qui porte l'appel) prime sur le reste.
 */

export type EtatLigneClient =
  | { etat: 'releve' }
  | { etat: 'inconnu' }
  | { etat: 'injoignable' }
  | { etat: 'deconnecte' }
  /** `plafond` : aucun appel ne part avant `jusqua` (ms depuis l'epoch, null si le pont ne la donne pas). */
  | { etat: 'libre'; plafond?: { jusqua: number | null } | null }
  /**
   * `decrocheLe` : heure du décroché donnée par le pont (ms), pour un chrono qui survit au rechargement. `entrant` : un
   * prospect qui rappelle (avec `appelId`), ou un numéro inconnu qui sonne sans réponse (sans).
   */
  | { etat: 'en-appel'; ligne: 'telephone'; appelId: string | null; decrocheLe?: number | null; entrant?: boolean }
  | { etat: 'en-appel'; ligne: 'navigateur' };

/** La campagne qui tourne ou attend, vue de toute page (lib/ligne). */
export interface CampagneLigne {
  id: string;
  entreprise: string;
  statut: 'en-cours' | 'en-pause';
  traites: number;
  total: number;
}

type Instantane = EtatLigneClient & { releveLe: number | null; campagne: CampagneLigne | null };
type Reponse = {
  pont: boolean;
  connecte?: boolean;
  appelEnCours?: boolean;
  appelId?: string | null;
  entrant?: boolean;
  decrocheLe?: number | null;
  plafond?: { jusqua: number | null } | null;
  campagne?: CampagneLigne | null;
};

const PERIODE_MS = 3000;
/** Sans relevé réussi depuis ce délai (onglet visible), l'état n'est plus affirmé. */
const PEREMPTION_MS = 10_000;

const SERVEUR: Instantane = { etat: 'releve', releveLe: null, campagne: null };
let instantane: Instantane = SERVEUR;
let dernierSucces: number | null = null;
let visibleDepuis = 0;
let enVol = false;
let minuterie: ReturnType<typeof setInterval> | null = null;
const abonnes = new Set<() => void>();

function depuisReponse(r: Reponse): EtatLigneClient {
  if (!r.pont) return { etat: 'injoignable' };
  if (r.appelEnCours) return { etat: 'en-appel', ligne: 'telephone', appelId: r.appelId ?? null, decrocheLe: r.decrocheLe ?? null, entrant: r.entrant === true };
  if (!r.connecte) return { etat: 'deconnecte' };
  return { etat: 'libre', plafond: r.plafond ?? null };
}

/** Comparaison de valeur, hors heure du relevé : des objets de quelques champs, relus toutes les 3 s. */
function identique(a: EtatLigneClient & { campagne: CampagneLigne | null }, b: EtatLigneClient & { campagne: CampagneLigne | null }): boolean {
  const sansReleve = (x: object) => JSON.stringify({ ...x, releveLe: null });
  return sansReleve(a) === sansReleve(b);
}

function poser(suivant: EtatLigneClient, releveLe: number | null, campagne: CampagneLigne | null = instantane.campagne) {
  // Même état et même relevé : l'instantané garde son identité, rien ne se redessine.
  const prochain = { ...suivant, campagne };
  if (identique(instantane, prochain) && instantane.releveLe === releveLe) return;
  instantane = { ...prochain, releveLe };
  for (const a of abonnes) a();
}

async function relever() {
  if (document.hidden || enVol) return;
  enVol = true;
  try {
    const r = await fetch('/ligne/etat', { cache: 'no-store', signal: AbortSignal.timeout(PEREMPTION_MS) });
    if (!r.ok) throw new Error(String(r.status));
    const corps = (await r.json()) as Reponse;
    dernierSucces = Date.now();
    poser(depuisReponse(corps), dernierSucces, corps.campagne ?? null);
  } catch {
    poser({ etat: 'inconnu' }, dernierSucces);
  } finally {
    enVol = false;
  }
}

function battre() {
  if (document.hidden) return;
  const reference = Math.max(dernierSucces ?? 0, visibleDepuis);
  if (instantane.etat !== 'releve' && Date.now() - reference > PEREMPTION_MS) poser({ etat: 'inconnu' }, dernierSucces);
  void relever();
}

function surVisibilite() {
  if (document.hidden) return;
  visibleDepuis = Date.now();
  void relever();
}

function abonner(abonne: () => void) {
  abonnes.add(abonne);
  if (!minuterie) {
    visibleDepuis = Date.now();
    minuterie = setInterval(battre, PERIODE_MS);
    document.addEventListener('visibilitychange', surVisibilite);
    void relever();
  }
  return () => {
    abonnes.delete(abonne);
    if (abonnes.size === 0 && minuterie) {
      clearInterval(minuterie);
      minuterie = null;
      document.removeEventListener('visibilitychange', surVisibilite);
    }
  };
}

export function useLigne(): Instantane {
  const telephone = useSyncExternalStore(
    abonner,
    () => instantane,
    () => SERVEUR,
  );
  const navigateur = useEtatLigne() === 'en-appel';
  const { releveLe, campagne } = telephone;
  const enNavigateur = useMemo<Instantane>(() => ({ etat: 'en-appel', ligne: 'navigateur', releveLe, campagne }), [releveLe, campagne]);
  return navigateur ? enNavigateur : telephone;
}
