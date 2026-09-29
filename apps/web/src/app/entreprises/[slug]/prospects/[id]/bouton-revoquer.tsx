'use client';

import { useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action } from '@/components/ui';
import { revoquerNumero } from '../actions';

/**
 * Révoquer un numéro : irréversible et valable pour tous les prospects qui le partagent, donc confirmé.
 * Reste monté après la révocation (la page le rend encore) pour dire ce qui vient de se passer.
 */
export function BoutonRevoquer({
  numero,
  lisible,
  partages,
  autorise = true,
}: {
  /** Numéro E.164, tel qu'en base. */
  numero: string;
  /** Le même, lisible (« 06 39 98 00 01 »). */
  lisible: string;
  partages: number;
  autorise?: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [fait, setFait] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const confirmation = useConfirmation();

  if (!autorise) {
    return fait ? (
      <p role="status" className="text-sm text-encre-2">
        {fait}
      </p>
    ) : null;
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Action ton="discret" className="-mx-1.5" aria-expanded={confirmation.ouverte} onClick={(e) => confirmation.ouvrir(e.currentTarget)}>
        Révoquer ce numéro
      </Action>
      <Confirmation
        className="justify-self-stretch"
        ouverte={confirmation.ouverte}
        ton="alerte"
        question={`Révoquer le ${lisible} ?`}
        libelleConfirmer="Révoquer le numéro"
        enCours={enCours}
        libelleEnCours="Révocation…"
        erreur={erreur}
        onAnnuler={() => {
          setErreur(null);
          confirmation.fermer();
        }}
        onConfirmer={() =>
          demarrer(async () => {
            setErreur(null);
            try {
              const resultat = await revoquerNumero(numero);
              if (!resultat.ok) return setErreur(resultat.raison);
              setFait(
                resultat.revoques === 0
                  ? 'Ce numéro était déjà révoqué : il ne sera plus jamais composé.'
                  : `Numéro révoqué (${resultat.revoques} consentement${resultat.revoques > 1 ? 's' : ''}) : il ne sera plus jamais composé.`,
              );
              confirmation.fermer();
            } catch {
              setErreur('La révocation n’a pas abouti : le numéro reste autorisé. Réessaie.');
            }
          })
        }
      >
        Ce numéro ne sera plus jamais appelé{partages > 1 ? `, pour les ${partages} prospects qui le partagent` : ''}. Aucun import ne pourra le
        réautoriser.
      </Confirmation>
    </div>
  );
}
