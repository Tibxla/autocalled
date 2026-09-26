'use client';

import { useActionState, useState } from 'react';
import { Bouton, Message } from '@/components/ui';
import { type RapportImport, importerFiches } from './actions';

function Ligne({ libelle, ids }: { libelle: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="text-sm">
      <span className="font-medium">
        {ids.length} {libelle}
      </span>{' '}
      <span className="font-mono text-encre-3">{ids.join(', ')}</span>
    </p>
  );
}

export function FormulaireImport({ entrepriseId, texteConsentement }: { entrepriseId: string; texteConsentement: string }) {
  const [rapport, action, enCours] = useActionState<RapportImport, FormData>(importerFiches.bind(null, entrepriseId), { etat: 'vide' });
  const [noms, setNoms] = useState<string[]>([]);

  return (
    <form action={action} className="grid gap-5">
      <label className="group grid cursor-pointer justify-items-start gap-2 rounded-lg px-5 py-6 shadow-[inset_0_0_0_1px_var(--filet-fort)] transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--encre-3)] has-[:focus-visible]:shadow-[inset_0_0_0_2px_var(--encre)]">
        <span className="font-medium">{noms.length === 0 ? 'Choisir des fiches prospect' : `${noms.length} fiche${noms.length > 1 ? 's' : ''} choisie${noms.length > 1 ? 's' : ''}`}</span>
        <span className="text-sm text-encre-2">
          {noms.length === 0 ? (
            <>
              Un fichier <span className="font-mono">.md</span> par prospect. Son nom devient l’identifiant :{' '}
              <span className="font-mono">julie-martin.md</span>.
            </>
          ) : (
            <span className="font-mono">{noms.join(', ')}</span>
          )}
        </span>
        <input
          type="file"
          name="fiches"
          accept=".md,text/markdown"
          multiple
          required
          className="sr-only"
          onChange={(e) => setNoms([...(e.target.files ?? [])].map((f) => f.name))}
        />
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consentement" required className="mt-0.5 size-4 shrink-0 accent-[var(--encre)]" />
        <span>
          Chaque personne de cette liste a accepté ce texte :
          <span className="mt-1 block text-encre-2">« {texteConsentement} »</span>
        </span>
      </label>

      <div className="flex items-center gap-4">
        <Bouton type="submit" disabled={enCours}>
          {enCours ? 'Import…' : 'Importer'}
        </Bouton>
      </div>

      {rapport.etat === 'erreur' ? <Message ton="alerte">{rapport.message}</Message> : null}
      {rapport.etat === 'fait' ? (
        <div role="status" className="grid gap-1.5 border-t border-filet pt-4">
          <Ligne libelle="créés" ids={rapport.crees} />
          <Ligne libelle="mis à jour" ids={rapport.misAJour} />
          <Ligne libelle="inchangés" ids={rapport.inchanges} />
          {rapport.numerosAutorises > 0 ? (
            <p className="text-sm text-encre-2">
              {rapport.numerosAutorises} numéro{rapport.numerosAutorises > 1 ? 's' : ''} autorisé{rapport.numerosAutorises > 1 ? 's' : ''} par cet import.
            </p>
          ) : null}
          {rapport.refus.map((r) => (
            <div key={r.nomFichier} className="text-sm text-alerte">
              <span className="font-mono">{r.nomFichier}</span> refusé : {r.erreurs.join(' ; ')}
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}
