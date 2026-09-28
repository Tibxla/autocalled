'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { demarrerAppelTelephone, lancerSimulation } from '@/app/appels/actions';
import { AppelEnDirect } from '@/components/appel-en-direct';
import { Bouton, Message, Selection } from '@/components/ui';

type Ligne = 'telephone' | 'navigateur' | 'simulation';

const LIGNES: { valeur: Ligne; libelle: string; aide: string }[] = [
  { valeur: 'telephone', libelle: 'Téléphone', aide: 'Mina appelle le vrai numéro depuis le téléphone passerelle.' },
  { valeur: 'navigateur', libelle: 'Navigateur', aide: 'Test : tu joues le prospect au micro, rien n’est composé.' },
  { valeur: 'simulation', libelle: 'Simulation', aide: 'Un modèle joue le prospect, sans audio. Signalé comme simulé partout.' },
];

/** Un choix de ligne et un seul bouton d'appel, comme au lancement d'une campagne. */
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
  const [ligne, setLigne] = useState<Ligne>('telephone');
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  if (!autorise) return <p className="text-sm text-encre-3">Ce numéro n’est pas autorisé : aucun appel possible.</p>;
  if (versions.length === 0) return <p className="text-sm text-encre-3">Crée d’abord un script pour cette entreprise.</p>;

  const prenom = prospectNom.split(' ')[0];
  const lancer = (action: () => Promise<{ ok: true; appelId: string } | { ok: false; raison: string }>) =>
    demarrer(async () => {
      setErreur(null);
      const r = await action();
      if (r.ok) router.push(`/appels/${r.appelId}`);
      else setErreur(r.raison);
    });

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

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Ligne</legend>
        <div className="grid grid-cols-3 rounded-md p-0.5 shadow-[inset_0_0_0_1px_var(--filet-fort)]">
          {LIGNES.map((l) => (
            <label
              key={l.valeur}
              className="cursor-pointer rounded-[5px] px-2 py-1.5 text-center text-sm text-encre-2 transition-colors duration-150 hover:text-encre has-[:checked]:bg-survol has-[:checked]:font-medium has-[:checked]:text-encre has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
            >
              <input type="radio" name="ligne-appel" value={l.valeur} checked={ligne === l.valeur} onChange={() => setLigne(l.valeur)} className="sr-only" />
              {l.libelle}
            </label>
          ))}
        </div>
        <p className="text-sm text-encre-3">{LIGNES.find((l) => l.valeur === ligne)?.aide}</p>
      </fieldset>

      {ligne === 'navigateur' ? (
        <AppelEnDirect key={versionId} entrepriseId={entrepriseId} prospectId={prospectId} prospectNom={prospectNom} versionScriptId={versionId} />
      ) : (
        <Bouton
          type="button"
          className="justify-self-start"
          disabled={enCours}
          onClick={() =>
            lancer(() =>
              ligne === 'telephone' ? demarrerAppelTelephone(entrepriseId, prospectId, versionId) : lancerSimulation(entrepriseId, prospectId, versionId),
            )
          }
        >
          {enCours ? (ligne === 'telephone' ? 'Composition…' : 'Simulation…') : ligne === 'telephone' ? `Appeler ${prenom}` : 'Simuler l’appel'}
        </Bouton>
      )}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </div>
  );
}
