'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action } from '@/components/ui';
import { supprimerEntreprise } from '../actions';

export function SuppressionEntreprise({ entrepriseId, nom, configuration }: { entrepriseId: string; nom: string; configuration: { objections: number; issues: number; scripts: number; versions: number } }) {
  const router = useRouter();
  const confirmation = useConfirmation();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const details = [
    configuration.objections ? `${configuration.objections} objection${configuration.objections > 1 ? 's' : ''}` : null,
    configuration.issues ? `${configuration.issues} issue${configuration.issues > 1 ? 's' : ''} personnalisée${configuration.issues > 1 ? 's' : ''}` : null,
    configuration.scripts ? `${configuration.scripts} script${configuration.scripts > 1 ? 's' : ''}` : null,
    configuration.versions ? `${configuration.versions} version${configuration.versions > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(', ');
  const supprimer = () => demarrer(async () => {
    setErreur(null);
    try {
      const resultat = await supprimerEntreprise(entrepriseId, true);
      if (!resultat.ok) return setErreur(resultat.raison);
      router.push('/entreprises');
      router.refresh();
    } catch {
      setErreur('La suppression a échoué : réessaie.');
    }
  });

  return (
    <div className="mt-8 grid max-w-[44rem] gap-2 border-t border-filet pt-4">
      <div className="-mx-1.5">
        <Action ton="discret" aria-expanded={confirmation.ouverte} disabled={enCours} onClick={(ev) => { setErreur(null); confirmation.ouvrir(ev.currentTarget); }}>
          Supprimer l’entreprise vide
        </Action>
      </div>
      <Confirmation
        ouverte={confirmation.ouverte}
        question={`Supprimer « ${nom} » ?`}
        libelleConfirmer="Supprimer l’entreprise"
        ton="alerte"
        enCours={enCours}
        libelleEnCours="Suppression…"
        erreur={erreur}
        onConfirmer={supprimer}
        onAnnuler={confirmation.fermer}
      >
        Cette entreprise n’a aucun prospect, import, appel ou campagne. Sa fiche et sa configuration seront supprimées définitivement
        {details ? ` : ${details}.` : '.'}
      </Confirmation>
    </div>
  );
}
