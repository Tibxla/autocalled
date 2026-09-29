'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

/**
 * Crochet commun à TOUS les formulaires. Constat vérifié dans react-dom 19.2.8 (startHostTransition) :
 * `requestFormReset` est appelé avant `action(formData)`, sans condition ; un `<form action={…}>` efface donc
 * tous les champs non contrôlés après chaque envoi, même quand le serveur refuse. Ici l'envoi passe par
 * onSubmit : la saisie reste en place après un refus, le focus va au premier champ en erreur, et
 * `avertirSiQuitte` prévient avant de fermer l'onglet sur une saisie non enregistrée.
 * La validation native (required, min, max, pattern) s'applique avant l'événement submit ; redirect() côté
 * serveur continue de fonctionner.
 */

const succesParDefaut = (etat: unknown) => (etat as { ok?: boolean } | null)?.ok === true;

export function useFormulaire<E>(
  action: (etat: E, donnees: FormData) => Promise<E>,
  initial: E,
  options: { estSucces?: (etat: E) => boolean; avertirSiQuitte?: boolean } = {},
): {
  etat: E;
  enCours: boolean;
  modifie: boolean;
  proprietes: {
    ref: RefObject<HTMLFormElement | null>;
    onSubmit: (e: FormEvent<HTMLFormElement>) => void;
    onInput: () => void;
    'aria-busy': boolean;
  };
} {
  const [etatAttendu, envoyer, enCours] = useActionState<E, FormData>(
    action as (etat: Awaited<E>, donnees: FormData) => Promise<E>,
    initial as Awaited<E>,
  );
  const etat = etatAttendu as E;
  const formulaire = useRef<HTMLFormElement | null>(null);
  const [modifie, setModifie] = useState(false);
  const estSucces = options.estSucces ?? succesParDefaut;

  // Un nouvel état qui est un succès : la saisie est enregistrée.
  const [etatVu, setEtatVu] = useState(etat);
  if (etat !== etatVu) {
    setEtatVu(etat);
    if (estSucces(etat)) setModifie(false);
  }

  // Après un refus, le focus va au premier champ en erreur (aria-invalid posé par Champ).
  const precedent = useRef(etat);
  useEffect(() => {
    if (precedent.current === etat) return;
    precedent.current = etat;
    if (estSucces(etat)) return;
    formulaire.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [etat, estSucces]);

  const avertir = Boolean(options.avertirSiQuitte) && modifie;
  useEffect(() => {
    if (!avertir) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [avertir]);

  return {
    etat,
    enCours,
    modifie,
    proprietes: {
      ref: formulaire,
      onSubmit: (e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const donnees = new FormData(e.currentTarget, submitter);
        startTransition(() => envoyer(donnees));
      },
      onInput: () => setModifie(true),
      'aria-busy': enCours,
    },
  };
}
