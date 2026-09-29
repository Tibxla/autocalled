import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { db } from '@/db';
import { prospects } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/pages';
import { versionsDeLEntreprise } from '@/lib/versions';
import { ApercuMina } from './apercu-mina';
import { FormulaireFiche } from './formulaire-fiche';

export const metadata: Metadata = { title: 'Fiche' };

export default async function PageFiche({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const [versions, listeProspects] = await Promise.all([
    versionsDeLEntreprise(entreprise.id),
    db
      .select({ id: prospects.id, nom: prospects.nom })
      .from(prospects)
      .where(eq(prospects.entrepriseId, entreprise.id))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
  ]);
  // Pleine largeur : la barre d'enregistrement collante va d'un bord à l'autre ; la colonne du formulaire fait 44 rem.
  return (
    <Page>
      <div className="pb-8">
        <ApercuMina entrepriseId={entreprise.id} prospects={listeProspects} versions={versions.map((v) => ({ id: v.id, libelle: v.libelle }))} />
      </div>
      <FormulaireFiche key={entreprise.id} fiche={entreprise} />
    </Page>
  );
}
