'use client';

import { useState, useTransition } from 'react';
import { Bouton } from '@/components/ui';
import { revoquerNumero } from '../actions';

export function BoutonRevoquer({ numero, partages }: { numero: string; partages: number }) {
  const [enCours, demarrer] = useTransition();
  const [confirmer, setConfirmer] = useState(false);

  if (!confirmer) {
    return (
      <Bouton type="button" variante="danger" onClick={() => setConfirmer(true)}>
        Révoquer ce numéro
      </Bouton>
    );
  }
  return (
    <div className="grid gap-3 rounded-md bg-alerte-fond p-3.5 text-sm">
      <p className="text-alerte">
        Ce numéro ne sera plus jamais appelé
        {partages > 1 ? `, pour les ${partages} prospects qui le partagent` : ''}. Un nouvel import le réautorisera.
      </p>
      <div className="flex gap-2">
        <Bouton type="button" variante="principal" disabled={enCours} onClick={() => demarrer(() => revoquerNumero(numero))}>
          {enCours ? 'Révocation…' : 'Révoquer'}
        </Bouton>
        <Bouton type="button" variante="discret" onClick={() => setConfirmer(false)}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
}
