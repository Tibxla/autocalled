'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { lancerSimulation } from '@/app/appels/actions';
import { AppelEnDirect } from '@/components/appel-en-direct';
import { Bouton, Message, Selection } from '@/components/ui';

export function PanneauAppel({
  entrepriseId,
  prospectId,
  prospectNom,
  versions,
  autorise,
}: {
  entrepriseId: string;
  prospectId: string;
  prospectNom: string;
  versions: { id: string; libelle: string }[];
  autorise: boolean;
}) {
  const router = useRouter();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? '');
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  if (!autorise) return <p className="text-sm text-encre-3">Ce numéro n’est pas autorisé : aucun appel possible.</p>;
  if (versions.length === 0) return <p className="text-sm text-encre-3">Crée d’abord un script pour cette entreprise.</p>;

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <label htmlFor="version-appel" className="text-sm font-medium">
          Version de script
        </label>
        <Selection id="version-appel" value={versionId} onChange={(e) => setVersionId(e.target.value)} className="font-mono">
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.libelle}
            </option>
          ))}
        </Selection>
      </div>
      <AppelEnDirect key={versionId} entrepriseId={entrepriseId} prospectId={prospectId} prospectNom={prospectNom} versionScriptId={versionId} />
      <div className="grid gap-2 border-t border-filet pt-4">
        <Bouton
          type="button"
          variante="discret"
          className="-ml-3.5 justify-self-start"
          disabled={enCours}
          onClick={() =>
            demarrer(async () => {
              setErreur(null);
              const r = await lancerSimulation(entrepriseId, prospectId, versionId);
              if (r.ok) router.push(`/appels/${r.appelId}`);
              else setErreur(r.raison);
            })
          }
        >
          {enCours ? 'Simulation…' : 'Simuler un appel'}
        </Bouton>
        <p className="text-sm text-encre-3">Un modèle joue le prospect, sans audio. Signalé comme simulé partout.</p>
        {erreur ? <Message ton="alerte">{erreur}</Message> : null}
      </div>
    </div>
  );
}
