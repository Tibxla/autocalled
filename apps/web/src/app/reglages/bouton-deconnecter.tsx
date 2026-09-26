'use client';

import { useTransition } from 'react';
import { Bouton } from '@/components/ui';
import { deconnecterGoogle } from './actions';

export function BoutonDeconnecter() {
  const [enCours, demarrer] = useTransition();
  return (
    <Bouton type="button" variante="discret" className="-ml-3.5 justify-self-start" disabled={enCours} onClick={() => demarrer(deconnecterGoogle)}>
      Déconnecter Google Agenda
    </Bouton>
  );
}
