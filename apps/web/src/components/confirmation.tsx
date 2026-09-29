'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Action } from './action';
import { useRaccourcis } from './clavier';

/**
 * Confirmation en ligne, juste sous l'action qui l'ouvre. Obligatoire pour tout geste qui fait sonner un
 * téléphone (appel, lancement ou reprise d'une campagne téléphone), prend la main, révoque,
 * oublie le téléphone, déconnecte l'API Google, remplace un bilan (Réanalyser) ou desserre un garde-fou.
 * Pas de confirmation pour les freins (Raccrocher, Suspendre), la ligne navigateur, la simulation,
 * l'archivage et les enregistrements de formulaire.
 *
 * Focus, tranché : à l'ouverture il va sur le CONTENEUR, jamais sur un bouton. Entrée confirme seulement
 * quand le focus est sur ce conteneur ; Espace y est sans effet (une seconde pression réflexe d'Espace après
 * « Espace Prendre la main » ne valide donc rien) ; Échap annule où que soit le focus ; Tab atteint les deux
 * boutons, qui gardent leur activation native. À la fermeture, le focus revient au déclencheur.
 *
 * En pleine largeur, jamais en plein écran ni en fenêtre modale. Sous 640 px, les actions s'empilent : l'action
 * en relief (au doigt) sur toute la largeur, « Annuler » dessous, en texte, sur toute la largeur. À l'ouverture,
 * elle vient dans la vue au plus court, au-dessus de la barre du bas, jamais dessous.
 */

export function useConfirmation(): { ouverte: boolean; ouvrir: (declencheur?: HTMLElement | null) => void; fermer: () => void } {
  const [ouverte, setOuverte] = useState(false);
  const declencheur = useRef<HTMLElement | null>(null);
  const ouvrir = useCallback((d?: HTMLElement | null) => {
    declencheur.current = d ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setOuverte(true);
  }, []);
  const fermer = useCallback(() => {
    setOuverte(false);
    const retour = declencheur.current;
    declencheur.current = null;
    // Après le rendu : le déclencheur peut avoir été masqué pendant la confirmation.
    if (retour) requestAnimationFrame(() => (retour.isConnected ? retour.focus() : undefined));
  }, []);
  return { ouverte, ouvrir, fermer };
}

export function Confirmation({
  ouverte,
  question,
  children,
  libelleConfirmer,
  libelleAnnuler = 'Annuler',
  ton = 'fort',
  enCours = false,
  libelleEnCours,
  erreur,
  onConfirmer,
  onAnnuler,
  className = '',
}: {
  ouverte: boolean;
  question: string;
  children?: React.ReactNode;
  libelleConfirmer: string;
  libelleAnnuler?: string;
  ton?: 'fort' | 'alerte';
  enCours?: boolean;
  libelleEnCours?: string;
  erreur?: string | null;
  onConfirmer: () => void | Promise<void>;
  onAnnuler: () => void;
  className?: string;
}) {
  const conteneur = useRef<HTMLDivElement>(null);
  const idQuestion = useId();
  const idConsequences = useId();

  useRaccourcis([
    {
      touche: 'Enter',
      libelle: libelleConfirmer,
      groupe: 'Confirmation',
      couche: 'confirmation',
      actif: ouverte && !enCours,
      action: () => {
        if (document.activeElement !== conteneur.current) return false;
        void onConfirmer();
      },
    },
    { touche: 'Escape', libelle: libelleAnnuler, groupe: 'Confirmation', couche: 'confirmation', dansChamp: true, actif: ouverte, action: () => onAnnuler() },
  ]);

  useEffect(() => {
    const el = conteneur.current;
    if (!ouverte || !el) return;
    el.focus({ preventScroll: true });
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: reduit ? 'auto' : 'smooth' });
  }, [ouverte]);

  if (!ouverte) return null;
  return (
    <div
      ref={conteneur}
      role="group"
      tabIndex={-1}
      aria-labelledby={idQuestion}
      aria-describedby={children ? idConsequences : undefined}
      onKeyDown={(e) => {
        // Espace sur le conteneur : rien, pas même le défilement.
        if (e.key === ' ' && e.target === e.currentTarget) e.preventDefault();
      }}
      className={`grid scroll-mt-[calc(var(--hauteur-barre)+16px)] scroll-mb-[calc(var(--hauteur-nav-bas)+16px)] gap-2 rounded-md bg-surface px-3.5 py-3 focus-visible:outline-trait focus-visible:outline-offset-0 ${className}`}
    >
      <p id={idQuestion} className="text-md font-medium text-encre">
        {question}
      </p>
      {children ? (
        <div id={idConsequences} className="max-w-[68ch] text-sm text-encre-2">
          {children}
        </div>
      ) : null}
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:grid max-sm:gap-2 pointer-coarse:mx-0">
        <Action
          ton={ton === 'alerte' ? 'alerte' : 'fort'}
          forme="relief"
          className="max-sm:w-full max-sm:justify-center"
          touche="Entrée"
          enCours={enCours}
          {...(libelleEnCours ? { libelleEnCours } : {})}
          disabled={enCours}
          onClick={() => void onConfirmer()}
        >
          {libelleConfirmer}
        </Action>
        <Action ton="discret" touche="Échap" onClick={onAnnuler} className="max-sm:h-11 max-sm:w-full max-sm:justify-center">
          {libelleAnnuler}
        </Action>
      </div>
      {erreur ? (
        <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
