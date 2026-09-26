'use client';

import { ISSUES_SYSTEME, LIBELLES_ISSUES } from '@autocalled/domain';
import { useActionState } from 'react';
import { Bouton, Champ, Saisie, Selection } from '@/components/ui';
import { ajouterIssue } from '../actions';

export function FormulaireIssue({ entrepriseId }: { entrepriseId: string }) {
  const [etat, action, enCours] = useActionState(ajouterIssue.bind(null, entrepriseId), null);
  const e = etat?.erreurs ?? {};
  return (
    <form action={action} className="grid gap-4 pt-6 sm:grid-cols-[1fr_16rem_auto] sm:items-start">
      <Champ libelle="Issue personnalisée" htmlFor="libelle-issue" erreur={e.libelle}>
        <Saisie id="libelle-issue" name="libelle" placeholder="Demande une maquette" required aria-invalid={e.libelle ? true : undefined} />
      </Champ>
      <Champ libelle="Rattachée à" htmlFor="issue-systeme" erreur={e.issueSysteme}>
        <Selection id="issue-systeme" name="issueSysteme" defaultValue="" required>
          <option value="" disabled>
            Choisir…
          </option>
          {ISSUES_SYSTEME.map((i) => (
            <option key={i} value={i}>
              {LIBELLES_ISSUES[i]}
            </option>
          ))}
        </Selection>
      </Champ>
      <Bouton type="submit" disabled={enCours} className="sm:mt-[1.625rem]">
        {enCours ? 'Ajout…' : 'Ajouter'}
      </Bouton>
    </form>
  );
}
