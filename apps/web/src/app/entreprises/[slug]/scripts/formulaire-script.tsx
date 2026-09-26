'use client';

import { useActionState } from 'react';
import { Bouton, Saisie } from '@/components/ui';
import { creerScript } from '../actions';

export function FormulaireScript({ entrepriseId, slug }: { entrepriseId: string; slug: string }) {
  const [etat, action, enCours] = useActionState(creerScript.bind(null, entrepriseId, slug), null);
  const erreur = etat?.erreurs?.nom;
  return (
    <form action={action} className="grid gap-1.5">
      <label htmlFor="nom-script" className="sr-only">
        Nom du nouveau script
      </label>
      <div className="flex gap-2">
        <Saisie id="nom-script" name="nom" placeholder="Nom du script" required className="w-56" aria-invalid={erreur ? true : undefined} />
        <Bouton type="submit" disabled={enCours}>
          {enCours ? 'Création…' : 'Créer'}
        </Bouton>
      </div>
      {erreur ? <p className="text-sm text-alerte">{erreur}</p> : null}
    </form>
  );
}
