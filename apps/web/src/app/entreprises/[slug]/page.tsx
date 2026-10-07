import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { db } from '@/db';
import { prospects } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/pages';
import { contenuEntreprise, obstacleSuppressionEntreprise } from '@/lib/entreprises';
import { versionsLancables } from '@/lib/versions';
import { ApercuMina } from './apercu-mina';
import { FormulaireFiche } from './formulaire-fiche';
import { SuppressionEntreprise } from './suppression-entreprise';

export const metadata: Metadata = { title: 'Fiche' };

export default async function PageFiche({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const [versions, listeProspects, contenu] = await Promise.all([
    versionsLancables(entreprise.id),
    db
      .select({ id: prospects.id, nom: prospects.nom })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entreprise.id), isNull(prospects.archiveLe)))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
    contenuEntreprise(entreprise.id),
  ]);
  // Pleine largeur : la barre d'enregistrement collante va d'un bord à l'autre ; la colonne du formulaire fait 44 rem.
  return (
    <Page>
      <div className="pb-8">
        <ApercuMina
          entrepriseId={entreprise.id}
          prospects={listeProspects}
          versions={versions.map((v) => ({ id: v.id, libelle: v.libelle }))}
          revision={entreprise.modifieLe.toISOString()}
        />
      </div>
      <FormulaireFiche key={entreprise.id} fiche={entreprise} />
      {obstacleSuppressionEntreprise(contenu) === null ? <SuppressionEntreprise entrepriseId={entreprise.id} nom={entreprise.nom} configuration={contenu.configuration} /> : null}
    </Page>
  );
}
