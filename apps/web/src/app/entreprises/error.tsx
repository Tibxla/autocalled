'use client';

import { useEffect, useRef } from 'react';
import { Action, LienAction } from '@/components/action';

/** Base injoignable pendant la lecture d'une entreprise ou de la liste. Next 16.3 passe `retry`. */
export default function ErreurEntreprises({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titre.current?.focus();
  }, []);
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2 pt-8">
      <h1 ref={titre} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em] focus:outline-none">
        La base ne répond pas.
      </h1>
      <p className="text-base text-encre-2">Rien n’a été modifié. Réessaie dans un instant.</p>
      {error.digest ? (
        <p className="text-sm text-encre-3">
          Référence <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="-mx-1.5 flex flex-wrap gap-x-4 gap-y-2 pt-2 pointer-coarse:mx-0">
        <Action ton="fort" onClick={() => retry()}>
          Réessayer
        </Action>
        <LienAction href="/entreprises">Revenir aux entreprises</LienAction>
      </div>
    </div>
  );
}
