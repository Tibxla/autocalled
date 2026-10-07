'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action } from '@/components/ui';
import { supprimerCampagne } from '../actions';

export function SuppressionCampagne({ campagneId, entrepriseSlug }: { campagneId: string; entrepriseSlug: string }) {
  const router = useRouter();
  const confirmation = useConfirmation();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const supprimer = () => demarrer(async () => {
    setErreur(null);
    try {
      const resultat = await supprimerCampagne(campagneId, true);
      if (!resultat.ok) return setErreur(resultat.raison);
      router.push(`/entreprises/${entrepriseSlug}/campagnes`);
      router.refresh();
    } catch {
      setErreur('La suppression a échoué : réessaie.');
    }
  });

  return (
    <div className="grid max-w-[44rem] gap-2 border-t border-filet pt-4">
      <div className="-mx-1.5">
        <Action ton="discret" aria-expanded={confirmation.ouverte} disabled={enCours} onClick={(ev) => { setErreur(null); confirmation.ouvrir(ev.currentTarget); }}>Supprimer la campagne prête</Action>
      </div>
      <Confirmation
        ouverte={confirmation.ouverte}
        question="Supprimer cette campagne jamais lancée ?"
        libelleConfirmer="Supprimer la campagne"
        ton="alerte"
        enCours={enCours}
        libelleEnCours="Suppression…"
        erreur={erreur}
        onConfirmer={supprimer}
        onAnnuler={confirmation.fermer}
      >
        La campagne et sa file seront supprimées définitivement. Les fiches des prospects et le script restent dans l’entreprise.
      </Confirmation>
    </div>
  );
}
