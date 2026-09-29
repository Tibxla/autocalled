'use client';

import { useRaccourci } from '@/components/clavier';
import { Action, Saisie } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import type { EtatFormulaire } from '@/lib/formulaire';

/**
 * Rangée de création en une ligne : un nom sur filet bas, « Entrée Créer », « Échap Annuler ». Sert aux
 * entreprises et aux scripts. L'envoi passe par useFormulaire : un refus (nom déjà pris, trop court) garde
 * la saisie et remet le focus dans le champ ; un succès suit le redirect() de l'action serveur.
 * La rangée ne s'ouvre que sur demande (N ou le clic) ou seule sur une liste vide : le focus y est attendu,
 * d'où l'autoFocus.
 */
export function RangeeCreation({
  action,
  id,
  libelle,
  placeholder,
  annulable,
  onAnnuler,
}: {
  action: (etat: EtatFormulaire, donnees: FormData) => Promise<EtatFormulaire>;
  id: string;
  libelle: string;
  placeholder: string;
  annulable: boolean;
  onAnnuler: () => void;
}) {
  const { etat, enCours, proprietes } = useFormulaire(action, null);
  const erreur = etat?.erreurs?.nom ?? (etat && !etat.ok ? etat.message : undefined);
  const formulaire = proprietes.ref;

  useRaccourci({
    touche: 'Escape',
    libelle: 'Annuler la création',
    dansChamp: true,
    actif: annulable && !enCours,
    action: () => {
      if (!formulaire.current?.contains(document.activeElement)) return false;
      onAnnuler();
    },
  });

  return (
    <form {...proprietes} aria-label={libelle} className="grid gap-1 border-b border-filet pt-1 pb-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label htmlFor={id} className="sr-only">
          {libelle}
        </label>
        <Saisie
          id={id}
          name="nom"
          autoFocus
          required
          maxLength={80}
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? `${id}-erreur` : undefined}
          className="max-w-[26rem] min-w-[12rem] flex-1"
        />
        <div className="-mx-1.5 flex items-center gap-3">
          <Action type="submit" ton="fort" touche="Entrée" enCours={enCours} libelleEnCours="Création…" disabled={enCours}>
            Créer
          </Action>
          {annulable ? (
            <Action ton="discret" touche="Échap" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </Action>
          ) : null}
        </div>
      </div>
      {erreur ? (
        <p id={`${id}-erreur`} className="text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
    </form>
  );
}
