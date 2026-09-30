'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Chevron } from './ui';

/**
 * Volet « Filtres (n) », sous 640 px seulement, pour une page qui a plusieurs familles de filtres (Appels) : les
 * familles secondaires y sont rangées, repliées. Le bouton compte les filtres actifs et les résume dessous
 * (« Téléphone · 7 jours · Toitures Vermeil ») ; déplié, les groupes s'empilent, chacun sous son libellé, puis
 * « Effacer les filtres ». Il reste ouvert pendant les navigations (l'état vit dans le composant, que le
 * changement de paramètres ne remonte pas). Dès 640 px, la page garde sa rangée de filtres habituelle.
 */
export function VoletFiltres({ resume, effacer, children }: { resume: string[]; effacer?: string | null; children: React.ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();
  const n = resume.length;
  return (
    <div className="grid gap-1 sm:hidden">
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        onClick={() => setOuvert((o) => !o)}
        className="-mx-1.5 inline-flex h-11 items-center gap-2 justify-self-start rounded-[4px] px-1.5 text-md font-medium text-encre-2 underline decoration-souligne decoration-1 underline-offset-4 active:bg-survol"
      >
        Filtres{n > 0 ? <span className="font-mono font-normal text-encre-3">({n})</span> : null}
        <Chevron direction="bas" ouvert={ouvert} className="stroke-encre-3" />
      </button>
      {n > 0 ? <p className="text-sm text-encre-3">{resume.join(' · ')}</p> : null}
      <div id={idPanneau} hidden={!ouvert} className="grid gap-5 border-b border-filet pt-2 pb-4">
        {children}
        {effacer ? (
          <Link
            href={effacer}
            scroll={false}
            className="inline-flex min-h-11 items-center justify-self-start text-sm text-encre-3 underline decoration-souligne decoration-1 underline-offset-4 active:text-encre-2"
          >
            Effacer les filtres
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Une famille de filtres dans le volet : libellé, puis ses filtres qui passent à la ligne ; une liste déroulante y
 * prend toute la largeur. Y poser des `Filtre` directement, pas une rangée `Filtres` (qui défile sous 640 px).
 */
export function GroupeFiltres({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid gap-1">
      <p id={id} className="text-sm text-encre-3">
        {libelle}
      </p>
      <div className="flex flex-wrap items-center gap-x-[22px] gap-y-1 [&_select]:w-full [&>div:has(select)]:w-full">{children}</div>
    </div>
  );
}
