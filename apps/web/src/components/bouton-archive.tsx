'use client';

import { useState, useTransition } from 'react';
import type { ResultatAction } from '@/lib/formulaire';
import { Action } from './action';

/**
 * Archiver ou réactiver une objection, une issue : geste réversible, sans confirmation. `nom` précise
 * l'élément pour les lecteurs d'écran (« Archiver « Trop cher » »).
 */
export function BoutonArchive({ action, archivee, nom }: { action: () => Promise<ResultatAction>; archivee: boolean; nom?: string }) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);
  const verbe = archivee ? 'Réactiver' : 'Archiver';
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Action
        ton="discret"
        enCours={enCours}
        libelleEnCours={archivee ? 'Réactivation…' : 'Archivage…'}
        disabled={enCours}
        aria-label={nom ? `${verbe} « ${nom} »` : undefined}
        onClick={() =>
          demarrer(async () => {
            setErreur(null);
            setFait(null);
            try {
              const resultat = await action();
              if (!resultat.ok) return setErreur(resultat.raison);
              setFait(archivee ? 'Réactivée.' : 'Archivée. Elle reste dans la liste des archivées.');
            } catch {
              setErreur(archivee ? 'La réactivation a échoué : réessaie.' : 'L’archivage a échoué : réessaie.');
            }
          })
        }
      >
        {verbe}
      </Action>
      {erreur ? (
        <span role="alert" className="rounded-md bg-alerte-fond px-2.5 py-1 text-sm text-alerte">
          {erreur}
        </span>
      ) : null}
      <span role="status" className="text-sm text-encre-3">
        {fait}
      </span>
    </span>
  );
}
