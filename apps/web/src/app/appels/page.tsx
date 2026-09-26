import { ISSUES_SYSTEME, type IssueSysteme, LIBELLES_ISSUES } from '@autocalled/domain';
import { type SQL, and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ListeAppels } from '@/components/liste-appels';
import { EnTetePage, EtatVide, Saisie, Selection } from '@/components/ui';
import { db } from '@/db';
import { appels, entreprises, prospects } from '@/db/schema';

export const metadata: Metadata = { title: 'Appels' };

const LIGNES = { navigateur: 'Navigateur', simulation: 'Simulé', bluetooth: 'Téléphone', twilio: 'Twilio' } as const;

type Filtres = { q?: string; entreprise?: string; issue?: string; ligne?: string };

export default async function PageAppels({ searchParams }: { searchParams: Promise<Filtres> }) {
  const f = await searchParams;
  const q = f.q?.trim() ?? '';
  const conditions: SQL[] = [];
  if (f.entreprise) conditions.push(eq(entreprises.slug, f.entreprise));
  if (f.issue && (ISSUES_SYSTEME as readonly string[]).includes(f.issue)) conditions.push(eq(appels.issueSysteme, f.issue as IssueSysteme));
  if (f.ligne && f.ligne in LIGNES) conditions.push(eq(appels.ligne, f.ligne as keyof typeof LIGNES));
  if (q) {
    // Cherche dans le nom du prospect, sa société, le résumé du bilan et toute la transcription.
    const motif = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const recherche = or(
      ilike(prospects.nom, motif),
      ilike(prospects.societe, motif),
      sql`${appels.bilan}->>'resume' ilike ${motif}`,
      sql`${appels.transcription}::text ilike ${motif}`,
    );
    if (recherche) conditions.push(recherche);
  }

  const [liste, listeEntreprises] = await Promise.all([
    db
      .select({ appel: appels, prospect: prospects.nom, entreprise: entreprises.nom })
      .from(appels)
      .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
      .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(appels.debutLe))
      .limit(200),
    db.select({ slug: entreprises.slug, nom: entreprises.nom }).from(entreprises).orderBy(asc(entreprises.nom)),
  ]);
  const filtre = Boolean(q || f.entreprise || f.issue || f.ligne);

  return (
    <>
      <EnTetePage
        titre="Appels"
        sousTitre="Tous les appels, du plus récent au plus ancien. Chaque appel ouvre son enregistrement, sa transcription et son bilan."
      />
      <form className="grid gap-3 border-b border-filet pb-6 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] sm:items-end" role="search">
        <label className="grid gap-1.5 text-sm font-medium">
          Rechercher
          <Saisie name="q" defaultValue={q} placeholder="Prospect, société, mot dit pendant l’appel…" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Entreprise
          <Selection name="entreprise" defaultValue={f.entreprise ?? ''}>
            <option value="">Toutes</option>
            {listeEntreprises.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.nom}
              </option>
            ))}
          </Selection>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Issue
          <Selection name="issue" defaultValue={f.issue ?? ''}>
            <option value="">Toutes</option>
            {ISSUES_SYSTEME.map((i) => (
              <option key={i} value={i}>
                {LIBELLES_ISSUES[i]}
              </option>
            ))}
          </Selection>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Ligne
          <Selection name="ligne" defaultValue={f.ligne ?? ''}>
            <option value="">Toutes</option>
            {Object.entries(LIGNES).map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </Selection>
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-md bg-encre px-3.5 text-sm font-medium text-fond shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-encre/88"
          >
            Filtrer
          </button>
          {filtre ? (
            <Link href="/appels" className="inline-flex h-9 items-center rounded-md px-3 text-sm text-encre-2 hover:bg-survol hover:text-encre">
              Effacer
            </Link>
          ) : null}
        </div>
      </form>
      <p className="pt-4 pb-1 text-sm text-encre-3">
        <span className="font-mono">{liste.length}</span> appel{liste.length > 1 ? 's' : ''}
        {liste.length === 200 ? ' (les 200 plus récents)' : ''}
      </p>
      {liste.length === 0 ? (
        <EtatVide titre={filtre ? 'Aucun appel ne correspond' : 'Aucun appel pour l’instant'}>
          {filtre ? 'Élargis les filtres ou change la recherche.' : 'Lance un appel depuis la fiche d’un prospect ou depuis une campagne.'}
        </EtatVide>
      ) : (
        <ListeAppels
          appels={liste.map(({ appel, prospect, entreprise }) => ({
            ...appel,
            resume: appel.bilan?.resume ?? null,
            prospect: `${prospect ?? appel.prospectId} · ${entreprise}`,
          }))}
        />
      )}
    </>
  );
}
