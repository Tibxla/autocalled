'use client';

import { useRef, useState, useTransition } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Action, Saisie } from '@/components/ui';
import { renommerIssue } from '../actions';

export function RenommageIssue({ entrepriseId, issueId, libelle }: { entrepriseId: string; issueId: string; libelle: string }) {
  const [edition, setEdition] = useState(false);
  const [saisie, setSaisie] = useState(libelle);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const bouton = useRef<HTMLButtonElement>(null);
  const formulaire = useRef<HTMLFormElement>(null);
  const fermer = () => {
    setEdition(false);
    requestAnimationFrame(() => bouton.current?.focus());
  };
  useRaccourci({ touche: 'Escape', libelle: 'Annuler le renommage de l’issue', dansChamp: true, actif: edition && !enCours, action: () => {
    if (!formulaire.current?.contains(document.activeElement)) return false;
    fermer();
  } });
  const id = `issue-renommee-${issueId}`;

  return edition ? (
    <form ref={formulaire} aria-label={`Renommer « ${libelle} »`} className="grid w-full gap-1 pb-2" onSubmit={(ev) => {
      ev.preventDefault();
      demarrer(async () => {
        setErreur(null);
        try {
          const resultat = await renommerIssue(entrepriseId, issueId, saisie);
          if (!resultat.ok) return setErreur(resultat.raison);
          fermer();
        } catch {
          setErreur('Le renommage a échoué : réessaie.');
        }
      });
    }}>
      <label htmlFor={id} className="text-sm font-medium">Libellé de l’issue personnalisée</label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Saisie id={id} value={saisie} onChange={(ev) => setSaisie(ev.target.value)} required minLength={2} maxLength={80} autoFocus autoComplete="off" aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${id}-erreur` : undefined} className="min-w-[12rem] max-w-[22rem] flex-1" />
        <Action type="submit" ton="fort" touche="Entrée" disabled={enCours} enCours={enCours} libelleEnCours="Enregistrement…">Enregistrer</Action>
        <Action ton="discret" touche="Échap" disabled={enCours} onClick={fermer}>Annuler</Action>
      </div>
      {erreur ? <p id={`${id}-erreur`} role="alert" className="text-sm text-alerte">{erreur}</p> : null}
    </form>
  ) : (
    <Action ref={bouton} ton="discret" aria-label={`Renommer « ${libelle} »`} onClick={() => { setSaisie(libelle); setErreur(null); setEdition(true); }}>Renommer</Action>
  );
}
