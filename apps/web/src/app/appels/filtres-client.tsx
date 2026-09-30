'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { Saisie, Selection } from '@/components/champs';
import { lienAvec } from '@/components/url';

/**
 * Filtres de la liste des appels qui rechargent la page dès le choix, sans bouton « Filtrer ». Les paramètres
 * actuels viennent du serveur (pas de useSearchParams, qui ferait passer la page en rendu client) ; changer un
 * filtre retire le curseur de pagination (`avant`).
 */

type Parametres = Record<string, string | undefined>;

function useAller(parametres: Parametres) {
  const router = useRouter();
  return (cle: string, valeur: string) => router.push(lienAvec('/appels', parametres, { [cle]: valeur || null, avant: null }), { scroll: false });
}

/** Liste déroulante : entreprise, version de script. `vide` est le libellé de l'option sans filtre. */
export function FiltreSelection({
  cle,
  libelle,
  vide,
  valeur,
  options,
  parametres,
  changements = {},
  className = 'w-56 max-w-full max-sm:w-full',
}: {
  cle: string;
  libelle: string;
  vide: string;
  valeur: string;
  options: { valeur: string; libelle: string }[];
  parametres: Parametres;
  /** Autres paramètres retirés au changement (la version quand l'entreprise change). */
  changements?: Record<string, null>;
  className?: string;
}) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex items-center max-sm:w-full">
      <label htmlFor={id} className="sr-only">
        {libelle}
      </label>
      <Selection
        key={valeur}
        id={id}
        defaultValue={valeur}
        onChange={(e) =>
          router.push(lienAvec('/appels', parametres, { ...changements, [cle]: e.target.value || null, avant: null }), { scroll: false })
        }
        className={className}
      >
        <option value="">{vide}</option>
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </Selection>
    </div>
  );
}

/** Un jour précis (jour de Paris) : la liste se limite à ce jour. */
export function FiltreJour({ valeur, parametres }: { valeur: string; parametres: Parametres }) {
  const aller = useAller(parametres);
  const id = useId();
  return (
    <div className="flex items-center">
      <label htmlFor={id} className="sr-only">
        Jour précis
      </label>
      <Saisie
        key={valeur}
        id={id}
        type="date"
        defaultValue={valeur}
        onChange={(e) => {
          // Saisie au clavier : l'année passe par 0002, 0020, 0202 avant 2026 ; seule une année plausible part.
          const v = e.target.value;
          if (v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2020)) aller('periode', v);
        }}
        className={`w-[9.5rem] font-mono ${valeur ? 'text-encre' : 'text-encre-3'}`}
      />
    </div>
  );
}
