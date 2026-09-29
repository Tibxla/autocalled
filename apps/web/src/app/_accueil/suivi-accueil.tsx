'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useTransition } from 'react';
import { useLigne, type EtatLigneClient } from '@/components/etat-ligne-telephone';
import type { AppelDuJour } from '@/lib/accueil';
import { ANALYSE_BLOQUEE_MS } from './situation';

/**
 * Rafraîchissements de l'accueil, sans rendu. La page relit la base (router.refresh) :
 * - quand la ligne change d'état (un appel démarre ou finit, l'appel suivant d'une campagne, la ligne qui
 *   revient ou tombe) ;
 * - toutes les 3 s, onglet visible, tant qu'un appel du jour vit ou s'analyse, et plus au-delà de 5 min
 *   d'analyse sans nouvelle (la bande dit alors « L'analyse ne progresse plus »).
 * Un seul rafraîchissement à la fois : le rendu serveur peut attendre la ligne jusqu'à 15 s.
 * Rien d'autre ne sonde : l'appel en cours a son propre flux dans la bande.
 */

const PERIODE_MS = 3000;
const DIX_MINUTES = 10 * 60 * 1000;

function cleLigne(e: EtatLigneClient): string | null {
  if (e.etat === 'releve' || e.etat === 'inconnu') return null;
  if (e.etat === 'en-appel') return e.ligne === 'telephone' ? `telephone:${e.appelId ?? ''}` : 'navigateur';
  return e.etat;
}

export function SuiviAccueil({ appels }: { appels: AppelDuJour[] }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const enVol = useRef(false);
  useEffect(() => {
    enVol.current = enCours;
  }, [enCours]);

  const rafraichir = useCallback(() => {
    if (enVol.current) return;
    enVol.current = true;
    demarrer(() => router.refresh());
  }, [router]);

  const cle = cleLigne(useLigne());
  const derniere = useRef<string | null>(null);

  useEffect(() => {
    if (cle === null) return;
    const avant = derniere.current;
    derniere.current = cle;
    if (avant === null) {
      // Premier relevé : la page a été rendue avec la ligne d'il y a un instant, d'après la base.
      const ouvert = appels.find((a) => a.statut === 'en-cours' && a.ligne === 'bluetooth' && Date.now() - Date.parse(a.debutLe) < DIX_MINUTES);
      const attendu = ouvert ? `telephone:${ouvert.id}` : null;
      if (cle.startsWith('telephone:') ? cle !== attendu : attendu !== null) rafraichir();
      return;
    }
    if (avant !== cle) rafraichir();
  }, [cle, appels, rafraichir]);

  const vivant = cle?.startsWith('telephone:') ?? false;
  useEffect(() => {
    const minuterie = setInterval(() => {
      if (document.hidden) return;
      const t = Date.now();
      const actif =
        vivant ||
        appels.some(
          (a) =>
            (a.statut === 'traitement' && t - Date.parse(a.finLe ?? a.debutLe) < ANALYSE_BLOQUEE_MS) ||
            (a.statut === 'en-cours' && a.ligne !== 'bluetooth' && t - Date.parse(a.debutLe) < DIX_MINUTES),
        );
      if (actif) rafraichir();
    }, PERIODE_MS);
    return () => clearInterval(minuterie);
  }, [appels, vivant, rafraichir]);

  return null;
}
