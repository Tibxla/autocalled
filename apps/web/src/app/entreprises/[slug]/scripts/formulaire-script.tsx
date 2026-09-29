'use client';

import { useRef, useState } from 'react';
import { RangeeCreation } from '@/components/rangee-creation';
import { Action, TitreSection } from '@/components/ui';
import { creerScript } from '../actions';

/** Titre de la liste des scripts, « N Nouveau script » et la rangée de création (dépliée d'office sans script). */
export function CreationScript({ entrepriseId, slug, compte }: { entrepriseId: string; slug: string; compte: number }) {
  const vide = compte === 0;
  const [ouverte, setOuverte] = useState(vide);
  const bouton = useRef<HTMLButtonElement>(null);
  const montree = ouverte || vide;

  return (
    <>
      <TitreSection
        id="titre-scripts"
        compte={compte}
        action={
          <Action
            ref={bouton}
            touche="N"
            raccourci="n"
            aria-expanded={montree}
            className="-mr-1.5"
            onClick={() => {
              setOuverte(true);
              requestAnimationFrame(() => document.getElementById('nom-script')?.focus());
            }}
          >
            Nouveau script
          </Action>
        }
      >
        Scripts
      </TitreSection>
      {montree ? (
        <div className="pt-2">
          <RangeeCreation
            action={creerScript.bind(null, entrepriseId, slug)}
            id="nom-script"
            libelle="Nom du nouveau script"
            placeholder="Nom du script"
            annulable={!vide}
            onAnnuler={() => {
              setOuverte(false);
              requestAnimationFrame(() => bouton.current?.focus());
            }}
          />
        </div>
      ) : null}
    </>
  );
}
