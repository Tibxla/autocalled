'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { Action } from '@/components/ui';

/** Intervalle du relevé automatique. */
const INTERVALLE_MS = 5000;

/**
 * Tient la page Téléphone à jour : relit l'état de la ligne toutes les 5 s, onglet visible seulement, et
 * tout de suite au retour sur l'onglet. Un relevé à la fois (la ligne peut mettre 15 s à répondre).
 * Jamais pendant une fenêtre d'appairage, une saisie non enregistrée ou un envoi : ces zones portent
 * `data-garde-releve` ou `aria-busy="true"`. « R Relire » fait la même chose à la demande.
 */
export function ReleveEtat({ luA }: { luA: string }) {
  const router = useRouter();
  const [auto, demarrerAuto] = useTransition();
  const [manuel, demarrerManuel] = useTransition();
  const occupe = useRef(false);

  useEffect(() => {
    occupe.current = auto || manuel;
  });

  useEffect(() => {
    const relire = () => {
      if (document.visibilityState !== 'visible' || occupe.current) return;
      if (document.querySelector('[data-garde-releve], form[aria-busy="true"]')) return;
      occupe.current = true;
      demarrerAuto(() => router.refresh());
    };
    const minuterie = setInterval(relire, INTERVALLE_MS);
    const auRetour = () => {
      if (document.visibilityState === 'visible') relire();
    };
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [router]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-encre-3">
      <span>
        lu à <span className="font-mono">{luA}</span>, relu toutes les 5 secondes
      </span>
      <Action
        ton="discret"
        className="-mx-1.5"
        touche="R"
        raccourci="r"
        libelleRaccourci="Relire l’état du téléphone"
        enCours={manuel}
        libelleEnCours="Relecture…"
        disabled={manuel}
        onClick={() => {
          occupe.current = true;
          demarrerManuel(() => router.refresh());
        }}
      >
        Relire
      </Action>
    </div>
  );
}
