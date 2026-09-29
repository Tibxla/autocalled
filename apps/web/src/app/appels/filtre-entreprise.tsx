'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { Selection } from '@/components/champs';
import { lienAvec } from '@/components/url';

/**
 * Filtre par entreprise de la liste des appels : la page se recharge dès le choix, sans bouton « Filtrer ».
 * Les paramètres actuels viennent du serveur (pas de useSearchParams, qui ferait passer la page en rendu client).
 */
export function FiltreEntreprise({
  valeur,
  entreprises,
  parametres,
}: {
  valeur: string;
  entreprises: { slug: string; nom: string }[];
  parametres: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const id = useId();
  if (entreprises.length < 2 && !valeur) return null;
  return (
    <div className="flex items-center">
      <label htmlFor={id} className="sr-only">
        Entreprise
      </label>
      <Selection
        key={valeur}
        id={id}
        defaultValue={valeur}
        onChange={(e) => router.push(lienAvec('/appels', parametres, { entreprise: e.target.value || null, n: null }), { scroll: false })}
        className="w-56 max-w-full"
      >
        <option value="">Toutes les entreprises</option>
        {entreprises.map((e) => (
          <option key={e.slug} value={e.slug}>
            {e.nom}
          </option>
        ))}
      </Selection>
    </div>
  );
}
