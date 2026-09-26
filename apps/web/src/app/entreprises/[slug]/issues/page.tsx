import { ISSUES_SYSTEME, LIBELLES_ISSUES, SENS_ISSUES } from '@autocalled/domain';
import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { BoutonArchive } from '@/components/bouton-archive';
import { TitreSection } from '@/components/ui';
import { db } from '@/db';
import { issuesPersonnalisees } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/donnees';
import { basculerArchiveIssue } from '../actions';
import { FormulaireIssue } from './formulaire-issue';

export const metadata: Metadata = { title: 'Issues' };


export default async function PageIssues({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const personnalisees = await db
    .select()
    .from(issuesPersonnalisees)
    .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id))
    .orderBy(asc(issuesPersonnalisees.libelle));

  return (
    <div className="grid max-w-[52rem] gap-12">
      <p className="max-w-[62ch] text-encre-2">
        Chaque appel se termine sur une seule issue. Les sept issues système sont fixes ; celles de l’entreprise les précisent, et
        le bilan choisit la plus précise.
      </p>

      <section>
        <TitreSection>Issues</TitreSection>
        <ul>
          {ISSUES_SYSTEME.map((issue) => {
            const enfants = personnalisees.filter((p) => p.issueSysteme === issue);
            return (
              <li key={issue} className="grid gap-x-8 gap-y-1 border-b border-filet py-4 sm:grid-cols-[14rem_1fr]">
                <span className="font-medium">{LIBELLES_ISSUES[issue]}</span>
                <div className="grid gap-2">
                  <span className="text-sm text-encre-2">{SENS_ISSUES[issue].charAt(0).toUpperCase() + SENS_ISSUES[issue].slice(1)}.</span>
                  {enfants.length > 0 ? (
                    <ul className="grid gap-1">
                      {enfants.map((p) => (
                        <li key={p.id} className={`flex items-center justify-between gap-4 text-sm ${p.archivee ? 'text-encre-3 line-through' : ''}`}>
                          <span>
                            <span aria-hidden="true" className="mr-2 text-encre-3">
                              └
                            </span>
                            {p.libelle}
                          </span>
                          <BoutonArchive archivee={p.archivee} action={basculerArchiveIssue.bind(null, entreprise.id, p.id, !p.archivee)} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <FormulaireIssue key={personnalisees.length} entrepriseId={entreprise.id} />
      </section>
    </div>
  );
}
