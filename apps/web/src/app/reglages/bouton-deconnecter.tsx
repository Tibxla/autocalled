'use client';

import { useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action } from '@/components/ui';
import type { ResultatAction } from '@/lib/formulaire';
import { deconnecterGoogle } from './actions';

/** Déconnecter l'API Google ralentit la lecture de l'agenda : le geste passe par une Confirmation. */
export function BoutonDeconnecter({ deconnecter = deconnecterGoogle }: { deconnecter?: () => Promise<ResultatAction> }) {
  const confirmation = useConfirmation();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <div className="-mx-1.5">
        <Action
          ton="discret"
          aria-expanded={confirmation.ouverte}
          onClick={(e) => {
            setErreur(null);
            confirmation.ouvrir(e.currentTarget);
          }}
        >
          Déconnecter l’API Google
        </Action>
      </div>
      <Confirmation
        ouverte={confirmation.ouverte}
        question="Déconnecter l’API Google ?"
        libelleConfirmer="Déconnecter"
        ton="alerte"
        enCours={enCours}
        libelleEnCours="Déconnexion…"
        erreur={erreur}
        onAnnuler={confirmation.fermer}
        onConfirmer={() =>
          demarrer(async () => {
            try {
              const resultat = await deconnecter();
              if (!resultat.ok) return setErreur(resultat.raison);
              confirmation.fermer();
            } catch {
              setErreur('La déconnexion a échoué. Réessaie dans un instant.');
            }
          })
        }
      >
        L’agenda sera de nouveau lu par le connecteur de claude.ai, plus lent (une vingtaine de secondes par lecture).
      </Confirmation>
    </div>
  );
}
