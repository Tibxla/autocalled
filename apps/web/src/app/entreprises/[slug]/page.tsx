import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { entrepriseParSlug } from '@/lib/pages';
import { FormulaireFiche } from './formulaire-fiche';

export const metadata: Metadata = { title: 'Fiche' };

export default async function PageFiche({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  // Pleine largeur : la barre d'enregistrement collante va d'un bord à l'autre ; la colonne du formulaire fait 44 rem.
  return (
    <Page>
      <FormulaireFiche key={entreprise.id} fiche={entreprise} />
    </Page>
  );
}
