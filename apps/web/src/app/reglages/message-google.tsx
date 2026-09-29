'use client';

import { useEffect, useState } from 'react';
import { Action, Message } from '@/components/ui';

const MESSAGES: Record<string, { ton: 'neutre' | 'alerte'; texte: string }> = {
  connecte: {
    ton: 'neutre',
    texte: 'L’API Google Agenda est connectée : l’agenda est désormais lu par elle.',
  },
  refuse: {
    ton: 'alerte',
    texte: 'La connexion a été refusée : le jeton de sécurité ne correspondait pas. Recommence.',
  },
  annule: { ton: 'alerte', texte: 'Connexion annulée côté Google.' },
};

/**
 * Le retour de la connexion Google (?google=…), affiché une fois puis retiré de l'adresse : un
 * rafraîchissement ne le remontre pas. window.history.replaceState est intégré au routeur de Next 16.3 et
 * ne relance pas la lecture de la page (l'agenda n'est pas relu pour si peu).
 */
export function MessageGoogle({ google }: { google?: string | undefined }) {
  const [code, setCode] = useState(google);

  useEffect(() => {
    if (!google) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('google')) return;
    url.searchParams.delete('google');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [google]);

  const message = code ? MESSAGES[code] : undefined;
  if (!message) return null;
  return (
    <Message
      ton={message.ton}
      action={
        <Action ton="discret" onClick={() => setCode(undefined)}>
          Masquer
        </Action>
      }
    >
      {message.texte}
    </Message>
  );
}
