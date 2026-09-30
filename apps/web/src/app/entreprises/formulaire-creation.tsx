'use client';

import { useRef, useState } from 'react';
import { NomDeLAssistante } from '@/components/assistante';
import { RangeeCreation } from '@/components/rangee-creation';
import { Action, EnTetePage } from '@/components/ui';
import { creerEntreprise } from './actions';

/** En-tête de la liste des entreprises et sa rangée de création, dépliée d'office quand la liste est vide. */
export function CreationEntreprise({ compte }: { compte: number }) {
  const vide = compte === 0;
  const [ouverte, setOuverte] = useState(vide);
  const bouton = useRef<HTMLButtonElement>(null);
  const montree = ouverte || vide;

  const ouvrir = () => {
    setOuverte(true);
    // Déjà ouverte : N ramène le focus dans le champ.
    requestAnimationFrame(() => document.getElementById('nom-entreprise')?.focus());
  };
  const fermer = () => {
    setOuverte(false);
    requestAnimationFrame(() => bouton.current?.focus());
  };

  return (
    <>
      <EnTetePage
        titre="Entreprises"
        compte={compte}
        sousTitre={
          <>
            Chaque entreprise que <NomDeLAssistante /> peut représenter.
          </>
        }
        action={
          <Action ref={bouton} ton="fort" touche="N" raccourci="n" aria-expanded={montree} onClick={ouvrir} className="-mr-1.5">
            Nouvelle entreprise
          </Action>
        }
      />
      {montree ? (
        <RangeeCreation
          action={creerEntreprise}
          id="nom-entreprise"
          libelle="Nom de la nouvelle entreprise"
          placeholder="Nom de l’entreprise"
          annulable={!vide}
          onAnnuler={fermer}
        />
      ) : null}
    </>
  );
}
