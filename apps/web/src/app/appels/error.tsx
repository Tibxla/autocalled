'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Action, LienAction } from '@/components/action';

/** Erreur de la liste des appels ou d'une fiche d'appel (ce fichier couvre les deux). Next 16.3 passe `retry`. */
export default function ErreurAppels({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const titre = useRef<HTMLHeadingElement>(null);
  const liste = usePathname() === '/appels';
  useEffect(() => {
    titre.current?.focus();
  }, []);
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2 pt-8">
      <h1 ref={titre} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em] focus:outline-none">
        {liste ? 'La liste des appels n’a pas pu être lue.' : 'Cet appel n’a pas pu être lu.'}
      </h1>
      <p className="text-base text-encre-2">La base n’a pas répondu à temps, ou la lecture a échoué. Rien n’a été modifié.</p>
      {error.digest ? (
        <p className="text-sm text-encre-3">
          Référence <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-2 pointer-coarse:mx-0">
        <Action ton="fort" onClick={() => retry()}>
          Réessayer
        </Action>
        {liste ? <LienAction href="/">Revenir à l’accueil</LienAction> : <LienAction href="/appels">Revenir aux appels</LienAction>}
      </div>
    </div>
  );
}
