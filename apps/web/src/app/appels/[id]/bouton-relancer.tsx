'use client';

import { useRef, useState, useTransition } from 'react';
import { Action, type TonAction } from '@/components/action';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { demanderAnalyse } from '../actions';

/**
 * Relance le rapatriement et l'analyse d'un appel. `confirmer` : le geste remplace un bilan existant, il passe
 * par une Confirmation. L'action pose `traitement` avant de répondre : la page revalidée montre l'analyse en
 * cours et se relit d'elle-même ; un refus (analyse déjà en cours, rien à rapatrier) s'affiche ici.
 */
export function BoutonRelancer({
  appelId,
  libelle,
  confirmer,
  ton = 'normal',
}: {
  appelId: string;
  libelle: string;
  confirmer?: { question: string; texte: string; libelle?: string };
  ton?: TonAction;
}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const bouton = useRef<HTMLButtonElement>(null);

  const lancer = () =>
    demarrer(async () => {
      setErreur(null);
      try {
        const resultat = await demanderAnalyse(appelId);
        if (!resultat.ok) return setErreur(resultat.raison);
        if (confirmer) confirmation.fermer();
      } catch {
        setErreur('La relance n’a pas pu partir. Réessaie dans un instant.');
      }
    });

  return (
    <div className="grid justify-items-start gap-2">
      <Action
        ref={bouton}
        ton={ton}
        enCours={enCours}
        libelleEnCours="Relance…"
        disabled={enCours}
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
