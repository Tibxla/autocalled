'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Chevron } from '@/components/ui';

/** Onglets qu'une autre entreprise possède aussi ; une page plus profonde (un script, un prospect) ramène à son onglet. */
const ONGLETS_PARTAGES = new Set(['scripts', 'objections', 'prospects', 'campagnes', 'analyse', 'issues']);

/**
 * Passer d'une entreprise à l'autre sans revenir à la liste, en gardant l'onglet ouvert : depuis l'analyse
 * d'une entreprise, on arrive sur l'analyse de l'autre. Un details sans habillage de bouton ; Échap et un
 * clic ailleurs le referment.
 */
export function ChoixEntreprise({ slug, autres }: { slug: string; autres: { slug: string; nom: string }[] }) {
  const chemin = usePathname();
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDetailsElement>(null);

  const reste = chemin.slice(`/entreprises/${slug}`.length).split('/')[1] ?? '';
  const suffixe = ONGLETS_PARTAGES.has(reste) ? `/${reste}` : '';

  const fermer = () => {
    setOuvert(false);
    racine.current?.querySelector('summary')?.focus();
  };

  useRaccourci({ touche: 'Escape', libelle: 'Fermer la liste des entreprises', dansChamp: true, actif: ouvert, action: () => fermer() });

  useEffect(() => {
    if (!ouvert) return;
    const ailleurs = (e: PointerEvent) => {
      if (e.target instanceof Node && !racine.current?.contains(e.target)) setOuvert(false);
    };
    document.addEventListener('pointerdown', ailleurs);
    return () => document.removeEventListener('pointerdown', ailleurs);
  }, [ouvert]);

  return (
    <details ref={racine} open={ouvert} onToggle={(e) => setOuvert(e.currentTarget.open)} className="relative">
      <summary
        aria-label="Changer d’entreprise"
        className="grid size-8 cursor-pointer list-none place-items-center rounded-[4px] text-encre-3 transition-colors duration-150 hover:text-encre pointer-coarse:size-11 [&::-webkit-details-marker]:hidden"
      >
        <Chevron direction="bas" ouvert={ouvert} />
      </summary>
      <ul
        aria-label="Autres entreprises"
        className="absolute top-full left-0 z-20 mt-1 max-h-[min(60vh,24rem)] w-max max-w-[min(22rem,calc(100vw-2rem))] min-w-[14rem] overflow-y-auto rounded-md border border-filet-2 bg-surface py-1"
      >
        {autres.map((e) => (
          <li key={e.slug}>
            <Link
              href={`/entreprises/${e.slug}${suffixe}`}
              onClick={() => setOuvert(false)}
              className="block truncate px-3 py-2 text-md text-encre-2 hover:bg-survol hover:text-encre focus-interne"
            >
              {e.nom}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
