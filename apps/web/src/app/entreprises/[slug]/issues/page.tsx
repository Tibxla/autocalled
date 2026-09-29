import { ISSUES_SYSTEME, LIBELLES_ISSUES, SENS_ISSUES } from '@autocalled/domain';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { BoutonArchive } from '@/components/bouton-archive';
import { issueEffective } from '@/components/format-appel';
import { LienAction, Page } from '@/components/ui';
import { db } from '@/db';
import { appels, issuesPersonnalisees } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/pages';
import { basculerArchiveIssue } from '../actions';
import { AjoutPrecision } from './formulaire-issue';

export const metadata: Metadata = { title: 'Issues' };

const majuscule = (texte: string) => texte.charAt(0).toLocaleUpperCase('fr-FR') + texte.slice(1);

export default async function PageIssues({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const [personnalisees, groupes] = await Promise.all([
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle, issueSysteme: issuesPersonnalisees.issueSysteme, archivee: issuesPersonnalisees.archivee })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id))
      .orderBy(asc(issuesPersonnalisees.archivee), asc(issuesPersonnalisees.libelle)),
    // Appels réels de l'entreprise par issue effective : le compte que montre Appels derrière le lien.
    db
      .select({ issueSysteme: appels.issueSysteme, issue: appels.issue, n: sql<number>`count(*)::int` })
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), ne(appels.ligne, 'simulation')))
      .groupBy(appels.issueSysteme, appels.issue),
  ]);
  const comptes = new Map<string, number>();
  for (const g of groupes) {
    const cle = issueEffective(g);
    if (cle) comptes.set(cle, (comptes.get(cle) ?? 0) + Number(g.n));
  }

  return (
    <Page largeur="lecture">
      <div className="grid max-w-[52rem] grid-cols-[minmax(0,1fr)] gap-6">
        <p className="max-w-[62ch] text-sm text-encre-3">
          Chaque appel se termine sur une seule issue. Les sept issues système sont fixes&nbsp;; les issues personnalisées de l’entreprise les
          détaillent, et le bilan choisit la plus précise.
        </p>

        <ul aria-label="Issues" className="border-t border-filet">
          {ISSUES_SYSTEME.map((issue) => {
            const precisions = personnalisees.filter((p) => p.issueSysteme === issue);
            const libelle = LIBELLES_ISSUES[issue];
            const nombre = comptes.get(issue) ?? 0;
            return (
              <li key={issue} className="grid gap-1 border-b border-filet py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-medium">{libelle}</span>
                    <span className="text-sm text-encre-3">{majuscule(SENS_ISSUES[issue])}.</span>
                  </div>
                  <LienAction
                    ton="discret"
                    href={`/appels?entreprise=${encodeURIComponent(slug)}&issue=${issue}`}
                    aria-label={`${nombre} ${nombre > 1 ? 'appels réels' : 'appel réel'} de l’entreprise terminé${nombre > 1 ? 's' : ''} sur « ${libelle} »`}
                    className="-mr-1.5"
                  >
                    Appels <span className="font-mono">{nombre}</span>
                  </LienAction>
                </div>
                {precisions.length > 0 ? (
                  <ul aria-label={`Issues personnalisées de « ${libelle} »`} className="grid pl-4">
                    {precisions.map((p) => (
                      <li key={p.id} className={`flex min-h-9 flex-wrap items-center gap-x-4 text-md ${p.archivee ? 'text-encre-3' : ''}`}>
                        <span className="min-w-0 flex-1">
                          {p.libelle}
                          {p.archivee ? <span className="text-sm"> · archivée</span> : null}
                        </span>
                        <BoutonArchive archivee={p.archivee} nom={p.libelle} action={basculerArchiveIssue.bind(null, entreprise.id, p.id, !p.archivee)} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="pl-4">
                  <AjoutPrecision entrepriseId={entreprise.id} issueSysteme={issue} libelleIssue={libelle} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Page>
  );
}
