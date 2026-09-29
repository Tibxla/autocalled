'use client';

import { catchError, type ErrorInfo } from 'next/error';
import { Action } from '@/components/action';
import { Message } from '@/components/ui';

/**
 * Frontière d'erreur autour de la bande : si la lecture de la ligne ou de l'appel en cours échoue, seule la
 * bande tombe ; la frise et le tableau, lus par la page hors de cette frontière, restent affichés.
 * `retry` relit la page dans une transition (Next 16.3), sans perdre l'état des filtres.
 */
function Repli(_: object, { retry }: ErrorInfo) {
  return (
    <div className="grid min-h-[188px] content-start pt-1 max-sm:min-h-0">
      <Message
        ton="alerte"
        titre="La ligne ne répond pas : la journée reste lisible ci-dessous."
        action={
          <Action ton="fort" onClick={() => retry()}>
            Réessayer
          </Action>
        }
      >
        L’état de la ligne et l’appel en cours n’ont pas pu être lus.
      </Message>
    </div>
  );
}

export const FrontiereLigne = catchError(Repli);
