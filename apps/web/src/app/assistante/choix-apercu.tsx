'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useId, useTransition } from 'react';
import { Selection } from '@/components/ui';

/**
 * Le choix de l'entreprise, de la version et du prospect de « ce que voit l'assistante ». Il passe par l'URL, pour
 * qu'un lien montre le même calcul : changer d'entreprise repart de sa première version, sans prospect.
 */
export function ChoixApercu({
  entreprises,
  versions,
  prospects,
  choix,
}: {
  entreprises: { slug: string; nom: string }[];
  versions: { id: string; libelle: string }[];
  prospects: { id: string; nom: string }[];
  choix: { entreprise: string; version: string; prospect: string };
}) {
  const id = useId();
  const router = useRouter();
  const chemin = usePathname();
  const [enCours, demarrer] = useTransition();

  const aller = (suivant: { entreprise: string; version?: string; prospect?: string }) => {
    const p = new URLSearchParams({ entreprise: suivant.entreprise });
    if (suivant.version) p.set('version', suivant.version);
    if (suivant.prospect) p.set('prospect', suivant.prospect);
    demarrer(() => router.replace(`${chemin}?${p.toString()}#vue`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3" aria-busy={enCours}>
      <div className="grid w-full gap-1.5 sm:w-[16rem]">
        <label htmlFor={`${id}-entreprise`} className="text-sm font-medium text-encre">
          Entreprise
        </label>
        <Selection id={`${id}-entreprise`} value={choix.entreprise} onChange={(ev) => aller({ entreprise: ev.target.value })}>
          {entreprises.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.nom}
            </option>
          ))}
        </Selection>
      </div>
      <div className="grid w-full gap-1.5 sm:w-[16rem]">
        <label htmlFor={`${id}-version`} className="text-sm font-medium text-encre">
          Version du script
        </label>
        <Selection
          id={`${id}-version`}
          value={choix.version}
          disabled={versions.length === 0}
          onChange={(ev) => aller({ entreprise: choix.entreprise, version: ev.target.value, prospect: choix.prospect })}
        >
          {versions.length === 0 ? <option value="">Aucun script</option> : null}
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.libelle}
            </option>
          ))}
        </Selection>
      </div>
      <div className="grid w-full gap-1.5 sm:w-[16rem]">
        <label htmlFor={`${id}-prospect`} className="text-sm font-medium text-encre">
          Prospect
        </label>
        <Selection
          id={`${id}-prospect`}
          value={choix.prospect}
          onChange={(ev) => aller({ entreprise: choix.entreprise, version: choix.version, prospect: ev.target.value })}
        >
          <option value="">Aucun prospect choisi</option>
          {prospects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom}
            </option>
          ))}
        </Selection>
      </div>
      <p role="status" className="pb-2 text-sm text-encre-3">
        {enCours ? 'Calcul…' : null}
      </p>
    </div>
  );
}
