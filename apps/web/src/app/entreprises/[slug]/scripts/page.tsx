import { asc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { scripts } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/donnees';
import { FormulaireScript } from './formulaire-script';

export const metadata: Metadata = { title: 'Scripts' };

export default async function PageScripts({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const liste = await db
    .select({
      id: scripts.id,
      nom: scripts.nom,
      version: sql<number>`(select max(v.numero) from versions_script v where v.script_id = scripts.id)`,
      etapes: sql<number>`(select jsonb_array_length(v.etapes) from versions_script v where v.script_id = scripts.id order by v.numero desc limit 1)`,
    })
    .from(scripts)
    .where(eq(scripts.entrepriseId, entreprise.id))
    .orderBy(asc(scripts.creeLe));

  return (
    <div className="grid max-w-[48rem] gap-8">
      <p className="max-w-[62ch] text-encre-2">
        Un script est un plan que Mina suit sans le réciter. Chaque modification crée une nouvelle version, pour que les bilans
        comparent des choses comparables.
      </p>
      <section>
        <TitreSection action={<FormulaireScript entrepriseId={entreprise.id} slug={slug} />}>Scripts</TitreSection>
        {liste.length === 0 ? (
          <EtatVide titre="Aucun script">
            Crée un premier script : il démarre avec quatre étapes (accroche, qualification, pitch, rendez-vous) que tu adaptes.
          </EtatVide>
        ) : (
          <ul>
            {liste.map((s) => (
              <li key={s.id} className="border-b border-filet">
                <Link
                  href={`/entreprises/${slug}/scripts/${s.id}`}
                  className="group flex items-baseline justify-between gap-4 py-4"
                >
                  <span className="font-medium group-hover:underline group-hover:decoration-filet-fort group-hover:underline-offset-4">
                    {s.nom}
                  </span>
                  <span className="text-sm text-encre-3">
                    <span className="font-mono">v{s.version}</span> · {s.etapes} étapes
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
