import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { dateCourte, etatAppel, issueEffective } from '@/components/format-appel';
import { Page } from '@/components/ui';
import { db } from '@/db';
import { appels, issuesPersonnalisees, prospects, textesConsentement } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { numeroLisible } from '@/lib/format';
import { entrepriseParSlug } from '@/lib/pages';
import { ListeProspects, type LigneProspect } from './liste-prospects';

export const metadata: Metadata = { title: 'Prospects' };

export default async function PageProspects({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filtre?: string | string[]; import?: string | string[] }>;
}) {
  const [{ slug }, recherche] = await Promise.all([params, searchParams]);
  const entreprise = await entrepriseParSlug(slug);
  const [liste, [texte], derniers, issuesPerso] = await Promise.all([
    db.select().from(prospects).where(eq(prospects.entrepriseId, entreprise.id)).orderBy(asc(prospects.nom), asc(prospects.id)),
    db.select().from(textesConsentement).orderBy(desc(textesConsentement.version)).limit(1),
    // Le dernier appel de chaque prospect, en une requête.
    db
      .selectDistinctOn([appels.prospectId], {
        prospectId: appels.prospectId,
        debutLe: appels.debutLe,
        statut: appels.statut,
        ligne: appels.ligne,
        issue: appels.issue,
        issueSysteme: appels.issueSysteme,
        erreur: appels.erreur,
        conversationId: appels.conversationId,
        rappel: sql<string | null>`${appels.bilan}->>'rappel'`,
      })
      .from(appels)
      .where(eq(appels.entrepriseId, entreprise.id))
      .orderBy(appels.prospectId, desc(appels.debutLe)),
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id)),
  ]);
  const autorisations = await autorisationsDe(liste.map((p) => p.telephone));
  const dernierDe = new Map(derniers.map((d) => [d.prospectId, d]));
  const libellePerso = new Map(issuesPerso.map((i) => [`perso:${i.id}`, i.libelle]));

  const lignes: LigneProspect[] = liste.map((p) => {
    const d = dernierDe.get(p.id);
    const lisible = numeroLisible(p.telephone);
    return {
      id: p.id,
      nom: p.nom,
      detail: [p.role, p.societe].filter(Boolean).join(', '),
      numero: lisible,
      chiffres: `${lisible.replace(/\D/g, '')} ${p.telephone.replace(/\D/g, '')}`,
      autorisation: autorisations.get(p.telephone),
      dernier: d
        ? { date: dateCourte(d.debutLe).split(' ')[0] ?? '', libelle: etatAppel(d, { libellePerso: d.issue ? libellePerso.get(d.issue) : null }).libelle }
        : null,
      rappel: d && d.statut === 'termine' && issueEffective(d) === 'rappel-convenu' ? (d.rappel ?? 'moment non précisé') : null,
    };
  });

  const filtre = typeof recherche.filtre === 'string' ? recherche.filtre : undefined;

  return (
    <Page largeur="pleine">
      <ListeProspects
        slug={slug}
        entrepriseId={entreprise.id}
        texteConsentement={texte?.texte ?? null}
        prospects={lignes}
        filtreInitial={filtre}
        importOuvert={recherche.import === '1'}
      />
    </Page>
  );
}
