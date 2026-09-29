import type { RappelDate } from '@autocalled/domain';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { dateCourte, etatAppel, quandRappeler } from '@/components/format-appel';
import { Page } from '@/components/ui';
import { db } from '@/db';
import { appels, issuesPersonnalisees, prospects, textesConsentement } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { numeroLisible } from '@/lib/format';
import { entrepriseParSlug } from '@/lib/pages';
import { ListeProspects, type LigneProspect } from './liste-prospects';

export const metadata: Metadata = { title: 'Prospects' };

/** L'heure se lit hors du rendu. */
function lireMaintenant(): Date {
  return new Date();
}

export default async function PageProspects({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filtre?: string | string[]; import?: string | string[] }>;
}) {
  const [{ slug }, recherche] = await Promise.all([params, searchParams]);
  const entreprise = await entrepriseParSlug(slug);
  const [liste, [texte], derniers, derniersReels, issuesPerso] = await Promise.all([
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
      })
      .from(appels)
      .where(eq(appels.entrepriseId, entreprise.id))
      .orderBy(appels.prospectId, desc(appels.debutLe)),
    // Le dernier appel hors simulation : rappel convenu, il est à faire (tout appel plus récent le fait).
    db
      .selectDistinctOn([appels.prospectId], {
        prospectId: appels.prospectId,
        issueSysteme: appels.issueSysteme,
        rappelLe: appels.rappelLe,
        quand: sql<RappelDate | null>`${appels.bilan}->'rappelLe'`,
        texte: sql<string | null>`${appels.bilan}->>'rappel'`,
      })
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), ne(appels.ligne, 'simulation')))
      .orderBy(appels.prospectId, desc(appels.debutLe)),
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id)),
  ]);
  const autorisations = await autorisationsDe(liste.map((p) => p.telephone));
  const dernierDe = new Map(derniers.map((d) => [d.prospectId, d]));
  const dernierReelDe = new Map(derniersReels.map((d) => [d.prospectId, d]));
  const maintenant = lireMaintenant();
  const phraseRappel = (prospectId: string): string | null => {
    const r = dernierReelDe.get(prospectId);
    if (r?.issueSysteme !== 'rappel-convenu') return null;
    if (!r.rappelLe) return r.texte ?? 'moment non précisé';
    return `${quandRappeler(r.rappelLe, r.quand, maintenant)}${r.texte ? ` (« ${r.texte} »)` : ''}`;
  };
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
      rappel: phraseRappel(p.id),
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
