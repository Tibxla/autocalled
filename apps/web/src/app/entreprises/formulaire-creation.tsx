'use client';

import { useActionState } from 'react';
import { Bouton, Saisie } from '@/components/ui';
import { creerEntreprise } from './actions';

export function FormulaireCreation() {
  const [etat, action, enCours] = useActionState(creerEntreprise, null);
  const erreur = etat?.erreurs?.nom;
  return (
    <form action={action} className="grid gap-1.5">
      <label htmlFor="nom-entreprise" className="sr-only">
        Nom de la nouvelle entreprise
      </label>
      <div className="flex gap-2">
        <Saisie
          id="nom-entreprise"
          name="nom"
          placeholder="Nom de l’entreprise"
          required
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? 'nom-entreprise-erreur' : undefined}
          className="w-64"
        />
        <Bouton type="submit" disabled={enCours}>
          {enCours ? 'Création…' : 'Créer'}
        </Bouton>
      </div>
      {erreur ? (
        <p id="nom-entreprise-erreur" className="text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
    </form>
  );
}
