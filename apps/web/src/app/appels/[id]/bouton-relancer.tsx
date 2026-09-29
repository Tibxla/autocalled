'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Action, type TonAction } from '@/components/action';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { relancerAnalyse } from '../actions';

const SUIVI_PAS_MS = 2000;
const SUIVI_MAX_MS = 40_000;

/**
 * Relance le rapatriement et l'analyse d'un appel. `confirmer` : le geste remplace un bilan existant, il passe
 * par une Confirmation. `suivre` : relancerAnalyse revalide la page AVANT que l'appel passe en traitement ; la
 * page est donc relue toutes les 2 s, 40 s au plus, jusqu'à ce que `statut` change.
 */
export function BoutonRelancer({
  appelId,
  libelle,
  confirmer,
  suivre = false,
  statut,
  ton = 'normal',
}: {
  appelId: string;
  libelle: string;
  confirmer?: { question: string; texte: string; libelle?: string };
  suivre?: boolean;
  /** Statut rendu par le serveur : son changement arrête le suivi. */
  statut?: string;
  ton?: TonAction;
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [suivi, setSuivi] = useState<{ statut: string | undefined } | null>(null);
  const [expire, setExpire] = useState(false);
  const confirmation = useConfirmation();
  const bouton = useRef<HTMLButtonElement>(null);

  const suiviActif = suivi !== null && !expire && suivi.statut === statut;

  useEffect(() => {
    if (!suiviActif) return;
    const relire = setInterval(() => router.refresh(), SUIVI_PAS_MS);
    const fin = setTimeout(() => setExpire(true), SUIVI_MAX_MS);
    return () => {
      clearInterval(relire);
      clearTimeout(fin);
    };
  }, [suiviActif, router]);

  const lancer = () =>
    demarrer(async () => {
      setErreur(null);
      try {
        await relancerAnalyse(appelId);
        if (confirmer) confirmation.fermer();
        if (suivre) {
          setExpire(false);
          setSuivi({ statut });
        }
      } catch {
        setErreur('La relance n’a pas pu partir. Réessaie dans un instant.');
      }
    });

  return (
    <div className="grid justify-items-start gap-2">
      <Action
        ref={bouton}
        ton={ton}
        enCours={enCours || suiviActif}
        libelleEnCours={suiviActif ? 'Analyse relancée…' : 'Relance…'}
        disabled={enCours || suiviActif}
        aria-expanded={confirmer ? confirmation.ouverte : undefined}
        onClick={() => (confirmer ? confirmation.ouvrir(bouton.current) : lancer())}
      >
        {libelle}
      </Action>
      {confirmer ? (
        <Confirmation
          ouverte={confirmation.ouverte}
          question={confirmer.question}
          libelleConfirmer={confirmer.libelle ?? libelle}
          enCours={enCours}
          libelleEnCours="Relance…"
          erreur={erreur}
          onConfirmer={lancer}
          onAnnuler={confirmation.fermer}
        >
          {confirmer.texte}
        </Confirmation>
      ) : null}
      {erreur && !confirmation.ouverte ? (
        <p role="alert" className="text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
