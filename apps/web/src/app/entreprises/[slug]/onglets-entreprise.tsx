'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRaccourcis } from '@/components/clavier';
import { LienNav } from '@/components/lien-nav';
import { RangeeDefilante } from '@/components/rangee-defilante';

/**
 * Onglets d'une entreprise, dans l'ordre du travail : décrire, écrire le script, préparer les objections,
 * importer les prospects, lancer, écouter, comparer. Les touches 1 à 8 (event.code : sans Maj en AZERTY)
 * y mènent, jamais depuis un champ de saisie. Une seule rangée (RangeeDefilante) : sous 640 px elle défile,
 * fondue du côté qui déborde, et l'onglet actif est centré à chaque navigation pour que ses voisins restent en
 * partie visibles. Ni liste déroulante ni deuxième rangée.
 */
export function OngletsEntreprise({ slug, comptes }: { slug: string; comptes: { scripts: number; objections: number; prospects: number } }) {
  const router = useRouter();
  const chemin = usePathname();
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

  return (
    <nav aria-label="Sections de l’entreprise" className="mt-4 border-b border-filet">
      <RangeeDefilante cle={chemin} className="gap-6 max-sm:gap-5">
        {onglets.map((o) => (
          <LienNav key={o.libelle} href={o.href} variante="onglet" {...(o.exact ? { exact: true } : {})} {...(o.compte !== undefined ? { compte: o.compte } : {})}>
            {o.libelle}
          </LienNav>
        ))}
      </RangeeDefilante>
    </nav>
  );
}
