import { asc, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PastilleAutorisation } from '@/components/pastille-autorisation';
import { EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { prospects, textesConsentement } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { entrepriseParSlug } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { FormulaireImport } from './formulaire-import';

export const metadata: Metadata = { title: 'Prospects' };

export default async function PageProspects({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const [liste, [texte]] = await Promise.all([
    db.select().from(prospects).where(eq(prospects.entrepriseId, entreprise.id)).orderBy(asc(prospects.nom)),
    db.select().from(textesConsentement).orderBy(desc(textesConsentement.version)).limit(1),
  ]);
  const autorisations = await autorisationsDe(liste.map((p) => p.telephone));

  return (
    <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="grid content-start">
        <TitreSection>
          Prospects <span className="font-normal text-encre-3">{liste.length}</span>
        </TitreSection>
        {liste.length === 0 ? (
          <EtatVide titre="Aucun prospect">
            Importe des fiches Markdown : un en-tête avec nom, telephone, societe et role, puis le contexte que Mina doit connaître.
          </EtatVide>
        ) : (
          <table className="w-full text-left">
            <thead className="sr-only">
              <tr>
                <th>Prospect</th>
                <th>Téléphone</th>
                <th>Autorisation</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((p) => (
                <tr key={p.id} className="group border-b border-filet">
                  <td className="py-4 pr-4 align-baseline">
                    <Link href={`/entreprises/${slug}/prospects/${p.id}`} className="grid gap-0.5">
                      <span className="font-medium group-hover:underline group-hover:decoration-filet-fort group-hover:underline-offset-4">
                        {p.nom}
                      </span>
                      <span className="text-sm text-encre-2">{[p.role, p.societe].filter(Boolean).join(', ') || '—'}</span>
                    </Link>
                  </td>
                  <td className="hidden w-40 py-4 pr-8 text-right align-baseline font-mono text-sm whitespace-nowrap text-encre-2 sm:table-cell">{numeroLisible(p.telephone)}</td>
                  <td className="w-40 py-4 text-right align-baseline whitespace-nowrap">
                    <PastilleAutorisation autorisation={autorisations.get(p.telephone)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid content-start gap-5">
        <TitreSection>Importer</TitreSection>
        {texte ? (
          <FormulaireImport entrepriseId={entreprise.id} texteConsentement={texte.texte} />
        ) : (
          <p className="text-sm text-alerte">Aucun texte de consentement en base : lance les migrations.</p>
        )}
      </section>
    </div>
  );
}
