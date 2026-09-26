import { entrepriseParSlug } from '@/lib/donnees';
import { FormulaireFiche } from './formulaire-fiche';

export default async function PageFiche({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  return <FormulaireFiche key={entreprise.id} fiche={entreprise} />;
}
