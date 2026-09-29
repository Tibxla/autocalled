'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { Action, LienAction } from '@/components/ui';
import type { Etape } from '@/db/schema';
import { EditeurVersion } from './editeur-version';

/**
 * La version affichée en lecture (ou sa comparaison, rendue par le serveur en `children`) et le passage à
 * l'éditeur : « V Nouvelle version » sur la dernière, « V Repartir de la v2 » sur une ancienne. V ne fait
 * qu'ouvrir l'éditeur ; seul « Enregistrer comme v4 » écrit.
 */
export function EspaceVersion({
  entrepriseId,
  scriptId,
  base,
  etapes,
  numeroAffiche,
  numeroDerniere,
  lienComparer,
  lienFermerComparaison,
  children,
}: {
  entrepriseId: string;
  scriptId: string;
  base: string;
  etapes: Etape[];
  numeroAffiche: number;
  numeroDerniere: number;
  lienComparer: string | null;
  lienFermerComparaison: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [edition, setEdition] = useState(false);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);

  // Autre version affichée (lien de la bande, ou retour sur la dernière après un enregistrement) : l'éditeur se referme.
  const [afficheeVue, setAfficheeVue] = useState(numeroAffiche);
  if (afficheeVue !== numeroAffiche) {
    setAfficheeVue(numeroAffiche);
    setEdition(false);
  }
  const derniere = numeroAffiche === numeroDerniere;
  const prochain = numeroDerniere + 1;

  const fermer = useCallback(() => {
    setEdition(false);
    requestAnimationFrame(() => bouton.current?.focus());
  }, []);
  const enregistree = useCallback(() => {
    setEdition(false);
    setAnnonce(`La v${prochain} est enregistrée. Les campagnes déjà lancées gardent leur version.`);
    // Repartie d'une ancienne version : on revient sur la dernière, celle qu'on vient de créer.
    if (!derniere) router.push(base, { scroll: false });
  }, [prochain, derniere, router, base]);

  return (
    <div className="grid gap-4">
      {/* Hors des deux branches : la région de statut existe déjà quand l'annonce arrive. */}
      <p role="status" className="text-sm text-encre-2 empty:-mb-4">
        {annonce}
      </p>
      {edition ? (
        <EditeurVersion
          entrepriseId={entrepriseId}
          scriptId={scriptId}
          etapes={etapes}
          origine={numeroAffiche}
          prochainNumero={prochain}
          onFermer={fermer}
          onEnregistree={enregistree}
        />
      ) : (
        <>
          <div className="-mx-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            <Action
              ref={bouton}
              ton={derniere ? 'fort' : 'normal'}
              touche="V"
              raccourci="v"
              libelleRaccourci={derniere ? 'Nouvelle version' : `Repartir de la v${numeroAffiche}`}
              onClick={() => {
                setAnnonce(null);
                setEdition(true);
              }}
            >
              {derniere ? `Nouvelle version (crée la v${prochain})` : `Repartir de la v${numeroAffiche}`}
            </Action>
            {lienComparer ? (
              <LienAction href={lienComparer} scroll={false}>
                Comparer avec la v{numeroDerniere}
              </LienAction>
            ) : null}
            {lienFermerComparaison ? (
              <LienAction href={lienFermerComparaison} ton="discret" scroll={false}>
                Fermer la comparaison
              </LienAction>
            ) : null}
          </div>
          {children}
        </>
      )}
    </div>
  );
}
