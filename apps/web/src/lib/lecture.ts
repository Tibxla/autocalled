import 'server-only';
import { ISSUES_SYSTEME, type IssueSysteme, statistiquesObjections, statistiquesParVersion } from '@autocalled/domain';
import { type SQL, and, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees, journalMcp, objections, prospects, rendezVous, versionsScript } from '@/db/schema';
import { versionsDeLEntreprise } from './versions';

/** Lectures partagées par les pages et le serveur MCP : une seule requête pour deux lecteurs. */

export const LIGNES = ['navigateur', 'simulation', 'bluetooth', 'twilio'] as const;
export type Ligne = (typeof LIGNES)[number];

export type FiltresAppels = { entreprise?: string; issue?: string; ligne?: string; recherche?: string };

/** Les appels du plus récent au plus ancien ; un filtre inconnu (issue, ligne) est ignoré, comme dans l'URL. */
export async function listerAppels(f: FiltresAppels, limite: number) {
  const conditions: SQL[] = [];
  if (f.entreprise) conditions.push(eq(entreprises.slug, f.entreprise));
  if (f.issue && (ISSUES_SYSTEME as readonly string[]).includes(f.issue)) conditions.push(eq(appels.issueSysteme, f.issue as IssueSysteme));
  if (f.ligne && (LIGNES as readonly string[]).includes(f.ligne)) conditions.push(eq(appels.ligne, f.ligne as Ligne));
  const q = f.recherche?.trim();
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
  return db
    .select({ appel: appels, prospect: prospects.nom, entreprise: entreprises.nom, entrepriseSlug: entreprises.slug })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(appels.debutLe))
    .limit(limite);
}

/** Un appel et ce qu'il faut pour lire son bilan (étapes, libellés des objections et des issues), ou null. */
export async function lireAppel(id: string) {
  const [appel] = await db.select().from(appels).where(eq(appels.id, id));
  if (!appel) return null;
  const [[entreprise], [prospect], [version], listeObjections, personnalisees, [rdv]] = await Promise.all([
    db.select().from(entreprises).where(eq(entreprises.id, appel.entrepriseId)),
    db
      .select()
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, appel.entrepriseId), eq(prospects.id, appel.prospectId))),
    db.select().from(versionsScript).where(eq(versionsScript.id, appel.versionScriptId)),
    db.select().from(objections).where(eq(objections.entrepriseId, appel.entrepriseId)),
    db.select().from(issuesPersonnalisees).where(eq(issuesPersonnalisees.entrepriseId, appel.entrepriseId)),
    db.select().from(rendezVous).where(eq(rendezVous.appelId, appel.id)),
  ]);
  if (!entreprise) return null;
  return { appel, entreprise, prospect: prospect ?? null, version: version ?? null, objections: listeObjections, personnalisees, rendezVous: rdv ?? null };
}

/**
 * Chiffres de l'écran d'analyse : par version de script (dans l'ordre des scripts, la plus récente d'abord)
 * et par objection. Les appels simulés sont exclus sauf demande, et toujours comptés à part.
 */
export async function analyseEntreprise(entrepriseId: string, avecSimules: boolean) {
  const [lignes, versions, listeObjections] = await Promise.all([
    db
      .select({ ligne: appels.ligne, versionScriptId: appels.versionScriptId, issueSysteme: appels.issueSysteme, bilan: appels.bilan })
      .from(appels)
      .where(and(eq(appels.entrepriseId, entrepriseId), eq(appels.statut, 'termine'), isNotNull(appels.issueSysteme))),
    versionsDeLEntreprise(entrepriseId),
    db.select().from(objections).where(eq(objections.entrepriseId, entrepriseId)),
  ]);

  const simules = lignes.filter((l) => l.ligne === 'simulation').length;
  const retenus = lignes
    .filter((l) => avecSimules || l.ligne !== 'simulation')
    .map((l) => ({
      versionScriptId: l.versionScriptId,
      issueSysteme: l.issueSysteme as IssueSysteme,
      etapeAtteinte: l.bilan?.etapeAtteinte ?? 0,
      objections: l.bilan?.objections ?? [],
    }));
  const parVersion = statistiquesParVersion(retenus).sort(
    (a, b) => versions.findIndex((v) => v.id === a.versionScriptId) - versions.findIndex((v) => v.id === b.versionScriptId),
  );
  return {
    simules,
    parVersion,
    parObjection: statistiquesObjections(retenus),
    libelleVersion: (id: string) => versions.find((v) => v.id === id)?.libelle ?? 'Version supprimée',
    libelleObjection: (id: string | null) =>
      id === null ? 'Objections nouvelles (absentes de la fiche)' : (listeObjections.find((o) => o.id === id)?.libelle ?? 'Objection supprimée'),
  };
}

/** Les derniers rendez-vous réservés par Mina, avec l'état de leur événement Google. */
export async function rendezVousRecents(limite = 20) {
  return db
    .select({ rdv: rendezVous, prospect: prospects.nom, appelId: appels.id })
    .from(rendezVous)
    .innerJoin(appels, eq(appels.id, rendezVous.appelId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .orderBy(desc(rendezVous.debut))
    .limit(limite);
}

/** Les derniers appels d'outils du serveur MCP (ADR 0009), du plus récent au plus ancien. */
export async function journalMcpRecent(limite = 30) {
  return db.select().from(journalMcp).orderBy(desc(journalMcp.le)).limit(limite);
}
