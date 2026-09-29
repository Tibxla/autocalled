'use client';

import type { IssueSysteme } from '@autocalled/domain';
import { useEffect, useRef, useState } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Action, Saisie } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import type { EtatFormulaire } from '@/lib/formulaire';
import { ajouterIssue } from '../actions';

/**
 * « Ajouter une issue personnalisée » sous une issue système : un seul champ, déjà rattaché (issueSysteme en champ
 * caché, lu par l'action dans le FormData). Entrée ajoute, Échap referme ; un refus garde la saisie.
 */
export function AjoutPrecision({ entrepriseId, issueSysteme, libelleIssue }: { entrepriseId: string; issueSysteme: IssueSysteme; libelleIssue: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const id = `precision-${issueSysteme}`;

  const fermer = () => {
    setOuvert(false);
    requestAnimationFrame(() => bouton.current?.focus());
  };

  if (!ouvert) {
    return (
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-3">
        <Action
          ref={bouton}
          ton="discret"
          aria-expanded={false}
          aria-label={`Ajouter une issue personnalisée à « ${libelleIssue} »`}
          onClick={() => {
            setAnnonce(null);
            setOuvert(true);
          }}
        >
          Ajouter une issue personnalisée
        </Action>
        <span role="status" className="text-sm text-encre-3">
          {annonce}
        </span>
      </div>
    );
  }
  return (
    <FormulairePrecision
      entrepriseId={entrepriseId}
      issueSysteme={issueSysteme}
      libelleIssue={libelleIssue}
      id={id}
      onAnnuler={fermer}
      onAjoutee={(libelle) => {
        setAnnonce(`« ${libelle} » ajoutée.`);
        fermer();
      }}
    />
  );
}

function FormulairePrecision({
  entrepriseId,
  issueSysteme,
  libelleIssue,
  id,
  onAnnuler,
  onAjoutee,
}: {
  entrepriseId: string;
  issueSysteme: IssueSysteme;
  libelleIssue: string;
  id: string;
  onAnnuler: () => void;
  onAjoutee: (libelle: string) => void;
}) {
  const { etat, enCours, proprietes } = useFormulaire<EtatFormulaire>(ajouterIssue.bind(null, entrepriseId), null);
  const erreur = etat?.erreurs?.libelle ?? etat?.erreurs?.issueSysteme ?? (etat && !etat.ok ? etat.message : undefined);
  const saisie = useRef<HTMLInputElement>(null);

  const vu = useRef(etat);
  useEffect(() => {
    if (vu.current === etat) return;
    vu.current = etat;
    if (etat?.ok) onAjoutee(saisie.current?.value.trim() ?? '');
  }, [etat, onAjoutee]);

  useRaccourci({
    touche: 'Escape',
    libelle: 'Annuler l’issue personnalisée',
    dansChamp: true,
    actif: !enCours,
    action: () => {
      if (!proprietes.ref.current?.contains(document.activeElement)) return false;
      onAnnuler();
    },
  });

  return (
    <form {...proprietes} aria-label={`Nouvelle issue personnalisée de « ${libelleIssue} »`} className="grid gap-1 pt-1">
      <input type="hidden" name="issueSysteme" value={issueSysteme} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label htmlFor={id} className="sr-only">
          Issue personnalisée de « {libelleIssue} »
        </label>
        <Saisie
          ref={saisie}
          id={id}
          name="libelle"
          autoFocus
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Demande une maquette"
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? `${id}-erreur` : undefined}
          className="max-w-[22rem] min-w-[12rem] flex-1"
        />
        <div className="-mx-1.5 flex items-center gap-3">
          <Action type="submit" ton="fort" touche="Entrée" enCours={enCours} libelleEnCours="Ajout…" disabled={enCours}>
            Ajouter
          </Action>
          <Action ton="discret" touche="Échap" onClick={onAnnuler} disabled={enCours}>
            Annuler
          </Action>
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
