'use client';

import { useEffect, useRef } from 'react';
import { Action, LienAction } from '@/components/action';

/** Erreur d'un segment (la barre reste visible : error.tsx ne couvre pas le layout racine). Next 16.3 passe `retry`. */
export default function Erreur({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titre.current?.focus();
  }, []);
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2 pt-8">
      <h1 ref={titre} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em] focus:outline-none">
        Cette page n’a pas pu se charger.
      </h1>
      <p className="text-base text-encre-2">La base ou la ligne n’a pas répondu à temps.</p>
      {error.digest ? (
        <p className="text-sm text-encre-3">
          Référence <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-2 pointer-coarse:mx-0">
        <Action ton="fort" onClick={() => retry()}>
          Réessayer
        </Action>
        <LienAction href="/">Revenir à l’accueil</LienAction>
      </div>
    </div>
  );
}
