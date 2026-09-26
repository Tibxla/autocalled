'use client';

import { useTransition } from 'react';
import { Bouton } from '@/components/ui';

export function BoutonArchive({ action, archivee }: { action: () => Promise<void>; archivee: boolean }) {
  const [enCours, demarrer] = useTransition();
  return (
    <Bouton type="button" variante="discret" disabled={enCours} onClick={() => demarrer(action)}>
      {archivee ? 'Réactiver' : 'Archiver'}
    </Bouton>
  );
}
