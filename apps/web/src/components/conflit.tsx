'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { Action } from './action';
import { Message } from './ui';

/**
 * Garde contre les modifications concurrentes (Claude Code par le serveur MCP, une autre fenêtre) : le formulaire
 * envoie en champ caché `connu` l'horodatage de la donnée qu'il affiche ; le serveur refuse si elle a changé
 * depuis. La saisie reste en place, et l'opérateur choisit : recharger (sa saisie est perdue, la donnée
 * enregistrée revient) ou écraser (le bouton renvoie le formulaire avec le jeton du conflit, champ `ecraser` :
 * une nouvelle écriture arrivée entre-temps provoquerait un nouveau refus, jamais un écrasement à l'aveugle).
 */

/**
 * `cle` sert de `key` au formulaire : « Recharger » relit la page et remonte le formulaire dans la même
 * transition, avec les valeurs fraîches du serveur.
 */
export function useRechargement(): { cle: number; recharger: () => void; enCours: boolean } {
  const router = useRouter();
  const [cle, setCle] = useState(0);
  const [enCours, demarrer] = useTransition();
  const recharger = useCallback(
    () =>
      demarrer(() => {
        router.refresh();
        setCle((c) => c + 1);
      }),
    [router],
  );
  return { cle, recharger, enCours };
}

/** Le champ caché de la garde, piloté par la donnée affichée (jamais `defaultValue`, sinon l'opérateur se bloquerait lui-même). */
export function ChampConnu({ valeur }: { valeur: string }) {
  return <input type="hidden" name="connu" value={valeur} />;
}

/** Message du refus, avec « Recharger » et « Écraser ». À placer DANS le formulaire : Écraser le soumet. */
export function MessageConflit({
  message,
  jeton,
  onRecharger,
  rechargement = false,
  libelleEcraser = 'Écraser',
  explication = 'Recharger reprend ce qui est enregistré et abandonne ta saisie ; Écraser enregistre ta saisie par-dessus.',
  desactive = false,
  className = '',
}: {
  message: string;
  jeton: string;
  onRecharger: () => void;
  rechargement?: boolean;
  libelleEcraser?: string;
  explication?: string;
  desactive?: boolean;
  className?: string;
}) {
  return (
    <Message
      ton="alerte"
      className={className}
      action={
        // Sous 640 px, Recharger et Écraser s'empilent : deux effets opposés, jamais côte à côte sous le doigt.
        <span className="flex flex-wrap gap-x-3 max-sm:grid max-sm:justify-items-start max-sm:gap-y-1">
          <Action ton="normal" onClick={onRecharger} enCours={rechargement} libelleEnCours="Rechargement…" disabled={rechargement || desactive}>
            Recharger
          </Action>
          <Action type="submit" name="ecraser" value={jeton} ton="normal" disabled={rechargement || desactive}>
            {libelleEcraser}
          </Action>
        </span>
      }
    >
      {message} {explication}
    </Message>
  );
}
