'use client';

import { useTransition } from 'react';
import { Bouton } from '@/components/ui';
import { recreerEvenement, relireAgenda } from './actions';

export function BoutonRelire() {
  const [enCours, demarrer] = useTransition();
  return (
    <Bouton type="button" variante="secondaire" className="justify-self-start" disabled={enCours} onClick={() => demarrer(relireAgenda)}>
      {enCours ? 'Lecture de l’agenda… (une vingtaine de secondes)' : 'Relire l’agenda maintenant'}
    </Bouton>
  );
}

export function BoutonRecreer({ rendezVousId }: { rendezVousId: string }) {
  const [enCours, demarrer] = useTransition();
  return (
    <Bouton type="button" variante="discret" disabled={enCours} onClick={() => demarrer(() => recreerEvenement(rendezVousId))}>
      Réessayer
    </Bouton>
  );
}
