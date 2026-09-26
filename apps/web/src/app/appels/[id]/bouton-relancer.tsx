'use client';

import { useTransition } from 'react';
import { Bouton } from '@/components/ui';
import { relancerAnalyse } from '../actions';

export function BoutonRelancer({ appelId, libelle }: { appelId: string; libelle: string }) {
  const [enCours, demarrer] = useTransition();
  return (
    <Bouton type="button" variante="secondaire" disabled={enCours} onClick={() => demarrer(() => relancerAnalyse(appelId))}>
      {enCours ? 'Relance…' : libelle}
    </Bouton>
  );
}
