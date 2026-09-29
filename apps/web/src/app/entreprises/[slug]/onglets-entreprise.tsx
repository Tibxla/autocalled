'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useRaccourcis } from '@/components/clavier';
import { LienNav } from '@/components/lien-nav';

/**
 * Onglets d'une entreprise, dans l'ordre du travail : décrire, écrire le script, préparer les objections,
 * importer les prospects, lancer, écouter, comparer. Les touches 1 à 8 (event.code : sans Maj en AZERTY)
 * y mènent, jamais depuis un champ de saisie. Sur mobile, seul ce bandeau défile, et l'onglet actif est
 * amené dans la vue à chaque navigation.
 */
export function OngletsEntreprise({ slug, comptes }: { slug: string; comptes: { scripts: number; objections: number; prospects: number } }) {
  const router = useRouter();
  const chemin = usePathname();
  const bande = useRef<HTMLDivElement>(null);
  const base = `/entreprises/${slug}`;

  const onglets: { libelle: string; href: string; exact?: boolean; compte?: number }[] = [
    { libelle: 'Fiche', href: base, exact: true },
    { libelle: 'Scripts', href: `${base}/scripts`, compte: comptes.scripts },
    { libelle: 'Objections', href: `${base}/objections`, compte: comptes.objections },
    { libelle: 'Prospects', href: `${base}/prospects`, compte: comptes.prospects },
    { libelle: 'Campagnes', href: `${base}/campagnes` },
    { libelle: 'Appels', href: `/appels?entreprise=${encodeURIComponent(slug)}` },
    { libelle: 'Analyse', href: `${base}/analyse` },
    { libelle: 'Issues', href: `${base}/issues` },
  ];

  useRaccourcis(
    onglets.map((o, i) => ({
      touche: String(i + 1),
      code: `Digit${i + 1}`,
      libelle: `Onglet ${o.libelle}`,
      groupe: 'Page' as const,
      action: () => router.push(o.href),
    })),
  );

  // L'onglet actif dans la vue du bandeau, sans faire défiler la page.
  useEffect(() => {
    const b = bande.current;
    const actif = b?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!b || !actif) return;
    const gauche = actif.offsetLeft;
    const droite = gauche + actif.offsetWidth;
    if (gauche < b.scrollLeft || droite > b.scrollLeft + b.clientWidth) b.scrollLeft = Math.max(0, gauche - 16);
  }, [chemin]);

  return (
    <nav aria-label="Sections de l’entreprise" className="mt-4 border-b border-filet">
      <div
        ref={bande}
        className="relative flex gap-6 overflow-x-auto [scrollbar-width:none] max-sm:-mx-(--gouttiere) max-sm:px-(--gouttiere) max-sm:gap-5"
      >
        {onglets.map((o) => (
          <LienNav key={o.libelle} href={o.href} variante="onglet" {...(o.exact ? { exact: true } : {})} {...(o.compte !== undefined ? { compte: o.compte } : {})}>
            {o.libelle}
          </LienNav>
        ))}
      </div>
    </nav>
  );
}
