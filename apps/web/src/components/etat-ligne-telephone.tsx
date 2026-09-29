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
  | { etat: 'libre' }
  | { etat: 'en-appel'; ligne: 'telephone'; appelId: string | null }
  | { etat: 'en-appel'; ligne: 'navigateur' };

type Instantane = EtatLigneClient & { releveLe: number | null };
type Reponse = { pont: boolean; connecte?: boolean; appelEnCours?: boolean; appelId?: string | null };

const PERIODE_MS = 3000;
/** Sans relevé réussi depuis ce délai (onglet visible), l'état n'est plus affirmé. */
const PEREMPTION_MS = 10_000;

const SERVEUR: Instantane = { etat: 'releve', releveLe: null };
let instantane: Instantane = SERVEUR;
let dernierSucces: number | null = null;
let visibleDepuis = 0;
let enVol = false;
let minuterie: ReturnType<typeof setInterval> | null = null;
const abonnes = new Set<() => void>();

function depuisReponse(r: Reponse): EtatLigneClient {
  if (!r.pont) return { etat: 'injoignable' };
  if (r.appelEnCours) return { etat: 'en-appel', ligne: 'telephone', appelId: r.appelId ?? null };
  if (!r.connecte) return { etat: 'deconnecte' };
  return { etat: 'libre' };
}

function identique(a: EtatLigneClient, b: EtatLigneClient): boolean {
  if (a.etat !== b.etat) return false;
  if (a.etat === 'en-appel' && b.etat === 'en-appel') {
    if (a.ligne !== b.ligne) return false;
    if (a.ligne === 'telephone' && b.ligne === 'telephone') return a.appelId === b.appelId;
  }
  return true;
}

function poser(suivant: EtatLigneClient, releveLe: number | null) {
  // Même état et même relevé : l'instantané garde son identité, rien ne se redessine.
  if (identique(instantane, suivant) && instantane.releveLe === releveLe) return;
  instantane = { ...suivant, releveLe };
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
    poser(depuisReponse(corps), dernierSucces);
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
  const releveLe = telephone.releveLe;
  const enNavigateur = useMemo<Instantane>(() => ({ etat: 'en-appel', ligne: 'navigateur', releveLe }), [releveLe]);
  return navigateur ? enNavigateur : telephone;
}
