import type { Metadata } from 'next';
import { LienTexte, Page } from '@/components/ui';
import { exigerOperateur } from '@/lib/garde';
import { entrepriseParSlug, prospectParId } from '@/lib/pages';
import { filesTelephoneEnCours } from '@/lib/prospects';
import { FormulaireProspect } from './formulaire-prospect';

export const metadata: Metadata = { title: 'Modifier le prospect' };

export default async function PageModifierProspect({ params }: { params: Promise<{ slug: string; id: string }> }) {
  await exigerOperateur();
  const { slug, id } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const prospect = await prospectParId(entreprise.id, id);
  const files = (await filesTelephoneEnCours(entreprise.id, [id])).get(id) ?? [];
  const retour = `/entreprises/${slug}/prospects/${id}`;
  return (
    <Page>
      <div className="grid gap-2 pb-8">
        <LienTexte isole href={retour} className="justify-self-start text-sm text-encre-3 hover:text-encre-2">{prospect.nom}</LienTexte>
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Modifier la fiche</h2>
      </div>
      <FormulaireProspect key={`${entreprise.id}/${id}`} prospect={prospect} retour={retour} files={files} />
    </Page>
  );
}
