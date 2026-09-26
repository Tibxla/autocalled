import Link from 'next/link';
import { LienNav } from '@/components/lien-nav';
import { entrepriseParSlug } from '@/lib/donnees';

export default async function LayoutEntreprise({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const base = `/entreprises/${slug}`;

  return (
    <>
      <div className="pt-10">
        <Link href="/entreprises" className="text-sm text-encre-3 transition-colors duration-150 hover:text-encre">
          Entreprises
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-balance">{entreprise.nom}</h1>
      </div>
      <nav aria-label="Sections de l’entreprise" className="mt-6 border-b border-filet pb-2">
        <div className="-mx-2.5 flex gap-1 overflow-x-auto">
        <LienNav href={base} exact>
          Fiche
        </LienNav>
        <LienNav href={`${base}/objections`}>Objections</LienNav>
        <LienNav href={`${base}/issues`}>Issues</LienNav>
        <LienNav href={`${base}/scripts`}>Scripts</LienNav>
        <LienNav href={`${base}/prospects`}>Prospects</LienNav>
        <LienNav href={`${base}/campagnes`}>Campagnes</LienNav>
        <LienNav href={`${base}/analyse`}>Analyse</LienNav>
        </div>
      </nav>
      <div className="pt-8">{children}</div>
    </>
  );
}
