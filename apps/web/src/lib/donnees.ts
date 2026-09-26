import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { entreprises, prospects } from '@/db/schema';

export async function listerEntreprises() {
  return db
    .select({
      id: entreprises.id,
      slug: entreprises.slug,
      nom: entreprises.nom,
      offre: entreprises.offre,
      nombreProspects: sql<number>`(select count(*)::int from prospects p where p.entreprise_id = entreprises.id)`,
      nombreObjections: sql<number>`(select count(*)::int from objections o where o.entreprise_id = entreprises.id and not o.archivee)`,
      nombreScripts: sql<number>`(select count(*)::int from scripts s where s.entreprise_id = entreprises.id)`,
    })
    .from(entreprises)
    .orderBy(asc(entreprises.nom));
}

export async function entrepriseParSlug(slug: string) {
  const [entreprise] = await db.select().from(entreprises).where(eq(entreprises.slug, slug)).limit(1);
  if (!entreprise) notFound();
  return entreprise;
}

export async function prospectParId(entrepriseId: string, id: string) {
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, id)))
    .limit(1);
  if (!prospect) notFound();
  return prospect;
}
