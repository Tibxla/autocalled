import 'server-only';
import { ISSUES_SYSTEME, type IssueSysteme, type TourDeParole, statistiquesObjections, statistiquesParVersion } from '@autocalled/domain';
import { type SQL, and, asc, desc, eq, ilike, isNotNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees, journalMcp, objections, prospects, rendezVous, versionsScript } from '@/db/schema';
import { RAPPEL_A_FAIRE } from './rappels';
import { versionsDeLEntreprise } from './versions';

/** Lectures partagées par les pages et le serveur MCP : une seule requête pour deux lecteurs. */

export const LIGNES = ['navigateur', 'simulation', 'bluetooth', 'twilio'] as const;
export type Ligne = (typeof LIGNES)[number];

/** Périodes nommées de la liste des appels ; une date `AAAA-MM-JJ` (jour de Paris) vaut aussi. */
export const PERIODES = ['aujourdhui', '7-jours', '30-jours', 'tout'] as const;
export type Periode = (typeof PERIODES)[number];

/** Filtres d'issue hors issue système : mêmes clés que `cleFiltreIssue` (components/liste-appels). */
export const ISSUE_NON_COMPOSE = 'non-compose';
export const ISSUE_SANS_BILAN = 'sans-bilan';

export type FiltresAppels = {
  entreprise?: string;
  /** Issue système, `non-compose`, `sans-bilan` ou `perso:<id>` (issue personnalisée). */
  issue?: string;
  ligne?: string;
  recherche?: string;
  /** Version de script (identifiant). */
  version?: string;
  /** `aujourdhui`, `7-jours` (aujourd'hui et les six jours d'avant), `30-jours`, `tout` ou une date `AAAA-MM-JJ`. */
  periode?: string;
  /** Sans ligne choisie, écarte les appels simulés (ils ne comptent dans aucun chiffre). */
  reels?: boolean;
  /** Seulement les rappels convenus encore à faire (aucun appel plus récent vers le prospect). */
  rappels?: boolean;
};

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Une date `AAAA-MM-JJ` qui existe au calendrier, sinon null. */
export function datePrecise(valeur: string | undefined): string | null {
  if (!valeur || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return null;
  const d = new Date(`${valeur}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valeur ? valeur : null;
}

/** Une période comprise (nommée ou date), sinon null (« tout »). */
export function periodeValide(valeur: string | undefined): Periode | string | null {
  if ((PERIODES as readonly string[]).includes(valeur ?? '')) return valeur as Periode;
  return datePrecise(valeur);
}

/**
 * Le filtre d'issue d'un appel, en SQL : la même règle que `cleFiltreIssue` (issue système, sinon « non
 * composé » pour un échec sans conversation, sinon « sans bilan »). Filtre et comptes partagent ce fragment.
 */
export const CLE_ISSUE = sql<string>`coalesce(${appels.issueSysteme}::text, case when ${appels.statut} = 'echec' and coalesce(${appels.conversationId}, '') = '' then 'non-compose' else 'sans-bilan' end)`;

/** L'issue choisie par l'analyse, personnalisée comprise (`perso:<id>`), comme la liste l'affiche. */
const ISSUE_CHOISIE = sql<string | null>`coalesce(${appels.issue}, ${appels.bilan}->>'issue')`;

/** Début d'un jour de Paris, `decalage` jours avant aujourd'hui. */
const debutJourParis = (decalage: number) =>
  sql`((date_trunc('day', now() at time zone 'Europe/Paris') - ${decalage}::int * interval '1 day') at time zone 'Europe/Paris')`;

function conditionPeriode(periode: string | undefined): SQL | null {
  switch (periode) {
    case 'aujourdhui':
      return sql`${appels.debutLe} >= ${debutJourParis(0)}`;
    case '7-jours':
      return sql`${appels.debutLe} >= ${debutJourParis(6)}`;
    case '30-jours':
      return sql`${appels.debutLe} >= ${debutJourParis(29)}`;
  }
  const date = datePrecise(periode);
  if (!date) return null;
  return sql`(${appels.debutLe} >= (${date}::date::timestamp at time zone 'Europe/Paris') and ${appels.debutLe} < ((${date}::date + 1)::timestamp at time zone 'Europe/Paris'))`;
}

function conditionIssue(issue: string | undefined): SQL | null {
  if (!issue) return null;
  if ((ISSUES_SYSTEME as readonly string[]).includes(issue)) return eq(appels.issueSysteme, issue as IssueSysteme);
  if (issue === ISSUE_NON_COMPOSE || issue === ISSUE_SANS_BILAN) return sql`${CLE_ISSUE} = ${issue}`;
  if (issue.startsWith('perso:') && FORME_UUID.test(issue.slice(6))) return sql`${ISSUE_CHOISIE} = ${issue}`;
  return null;
}

/** Les conditions des filtres, sur appels joint à entreprises et (à gauche) à prospects. Un filtre inconnu est ignoré. */
function conditionsAppels(f: FiltresAppels, { sansIssue = false } = {}): SQL[] {
  const conditions: SQL[] = [];
  if (f.entreprise) conditions.push(eq(entreprises.slug, f.entreprise));
  const issue = sansIssue ? null : conditionIssue(f.issue);
  if (issue) conditions.push(issue);
  if (f.ligne && (LIGNES as readonly string[]).includes(f.ligne)) conditions.push(eq(appels.ligne, f.ligne as Ligne));
  else if (f.reels) conditions.push(ne(appels.ligne, 'simulation'));
  if (f.version && FORME_UUID.test(f.version)) conditions.push(eq(appels.versionScriptId, f.version));
  const periode = conditionPeriode(f.periode);
  if (periode) conditions.push(periode);
  if (f.rappels) conditions.push(RAPPEL_A_FAIRE);
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
  return conditions;
}

const JOINTURE_PROSPECT = and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId));

/** Les appels strictement plus anciens que l'appel `id` dans l'ordre de la liste (début, puis identifiant). */
function plusAnciensQue(id: string): SQL {
  return sql`(${appels.debutLe}, ${appels.id}) < (select c.debut_le, c.id from appels c where c.id = ${id})`;
}

function plusRecentsQue(id: string): SQL {
  return sql`(${appels.debutLe}, ${appels.id}) > (select c.debut_le, c.id from appels c where c.id = ${id})`;
}

/**
 * Les appels du plus récent au plus ancien ; un filtre inconnu (issue, ligne, période) est ignoré, comme dans
 * l'URL. `avant` (identifiant d'un appel) ne garde que les appels plus anciens que lui : pagination par curseur.
 */
export async function listerAppels(f: FiltresAppels, limite: number, { avant }: { avant?: string } = {}) {
  const conditions = conditionsAppels(f);
  if (avant && FORME_UUID.test(avant)) conditions.push(plusAnciensQue(avant));
  return db
    .select({ appel: appels, prospect: prospects.nom, entreprise: entreprises.nom, entrepriseSlug: entreprises.slug })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, JOINTURE_PROSPECT)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(appels.debutLe), desc(appels.id))
    .limit(limite);
}

/**
 * Une page de la liste des appels, sans les colonnes lourdes (transcription seulement pendant une recherche,
 * pour l'extrait) : société, nombre d'étapes, libellé d'issue personnalisée et rendez-vous en une requête.
 * `suivant` est le curseur de la page suivante (plus ancienne), null en fin de liste.
 */
export async function pageAppels(f: FiltresAppels, { taille, avant }: { taille: number; avant?: string }) {
  const conditions = conditionsAppels(f);
  if (avant && FORME_UUID.test(avant)) conditions.push(plusAnciensQue(avant));
  const avecTranscription = Boolean(f.recherche?.trim());
  const lignes = await db
    .select({
      id: appels.id,
      debutLe: appels.debutLe,
      ligne: appels.ligne,
      statut: appels.statut,
      issueSysteme: appels.issueSysteme,
      issue: appels.issue,
      erreur: appels.erreur,
      conversationId: appels.conversationId,
      dureeSecondes: appels.dureeSecondes,
      prospectId: appels.prospectId,
      avecBilan: sql<boolean>`${appels.bilan} is not null`,
      etapeAtteinte: sql<number | null>`(${appels.bilan}->>'etapeAtteinte')::int`,
      resume: sql<string | null>`${appels.bilan}->>'resume'`,
      transcription: sql<TourDeParole[] | null>`${avecTranscription ? appels.transcription : sql`null`}`.mapWith(appels.transcription),
      prospect: prospects.nom,
      societe: prospects.societe,
      entreprise: entreprises.nom,
      entrepriseSlug: entreprises.slug,
      rappelLe: appels.rappelLe,
      versionScriptId: appels.versionScriptId,
      campagneId: appels.campagneId,
      assistanteNom: appels.assistanteNom,
      nombreEtapes: sql<number | null>`jsonb_array_length(${versionsScript.etapes})`.mapWith(Number),
      libellePerso: issuesPersonnalisees.libelle,
      rendezVous: sql<boolean>`exists (select 1 from ${rendezVous} where ${rendezVous.appelId} = ${appels.id})`,
    })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, JOINTURE_PROSPECT)
    .leftJoin(versionsScript, eq(versionsScript.id, appels.versionScriptId))
    .leftJoin(issuesPersonnalisees, sql`${ISSUE_CHOISIE} = 'perso:' || ${issuesPersonnalisees.id}::text`)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(appels.debutLe), desc(appels.id))
    .limit(taille + 1);
  const page = lignes.slice(0, taille);
  return { lignes: page, suivant: lignes.length > taille ? (page.at(-1)?.id ?? null) : null };
}

/**
 * Comptes de la liste, en base : par filtre d'issue (clés de `CLE_ISSUE`) et par issue personnalisée
 * (`perso:<id>`), sur tous les filtres SAUF l'issue, pour que chaque filtre dise combien il en montrera.
 */
export async function comptesAppels(f: FiltresAppels): Promise<{ total: number; parIssue: Record<string, number>; parPerso: Record<string, number> }> {
  const conditions = conditionsAppels(f, { sansIssue: true });
  const perso = sql<string | null>`case when ${ISSUE_CHOISIE} like 'perso:%' then ${ISSUE_CHOISIE} end`;
  const lignes = await db
    .select({ cle: CLE_ISSUE, perso, nombre: sql<number>`count(*)`.mapWith(Number) })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, JOINTURE_PROSPECT)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(CLE_ISSUE, perso);
  const parIssue: Record<string, number> = {};
  const parPerso: Record<string, number> = {};
  let total = 0;
  for (const l of lignes) {
    total += l.nombre;
    parIssue[l.cle] = (parIssue[l.cle] ?? 0) + l.nombre;
    if (l.perso) parPerso[l.perso] = (parPerso[l.perso] ?? 0) + l.nombre;
  }
  return { total, parIssue, parPerso };
}

/** Nombre d'appels de chaque jour de Paris demandé (`AAAA-MM-JJ`), tous filtres compris : les intertitres d'une page. */
export async function comptesParJour(f: FiltresAppels, jours: readonly string[]): Promise<Record<string, number>> {
  const valides = [...new Set(jours)].filter((j) => datePrecise(j));
  if (valides.length === 0) return {};
  const jour = sql<string>`to_char(${appels.debutLe} at time zone 'Europe/Paris', 'YYYY-MM-DD')`;
  const conditions = conditionsAppels(f);
  conditions.push(sql`(${appels.debutLe} at time zone 'Europe/Paris')::date in (${sql.join(
    valides.map((j) => sql`${j}::date`),
    sql`, `,
  )})`);
  const lignes = await db
    .select({ jour, nombre: sql<number>`count(*)`.mapWith(Number) })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, JOINTURE_PROSPECT)
    .where(and(...conditions))
    .groupBy(jour);
  return Object.fromEntries(lignes.map((l) => [l.jour, l.nombre]));
}

/** L'appel d'avant (plus récent) et d'après (plus ancien) dans la liste filtrée, sans limite de fenêtre. */
export async function voisinsAppel(id: string, f: FiltresAppels): Promise<{ precedent: string | null; suivant: string | null }> {
  if (!FORME_UUID.test(id)) return { precedent: null, suivant: null };
  const conditions = conditionsAppels(f);
  const voisin = (sens: 'precedent' | 'suivant') =>
    db
      .select({ id: appels.id })
      .from(appels)
      .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
      .leftJoin(prospects, JOINTURE_PROSPECT)
      .where(and(...conditions, sens === 'precedent' ? plusRecentsQue(id) : plusAnciensQue(id)))
      .orderBy(...(sens === 'precedent' ? [asc(appels.debutLe), asc(appels.id)] : [desc(appels.debutLe), desc(appels.id)]))
      .limit(1);
  const [[precedent], [suivant]] = await Promise.all([voisin('precedent'), voisin('suivant')]);
  return { precedent: precedent?.id ?? null, suivant: suivant?.id ?? null };
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

/** Les versions d'agent ElevenLabs commencent par agtvrsn_ : aucune ne se confond avec ce repère. */
const VERSION_AGENT_INCONNUE = 'inconnue';

/**
 * Chiffres de l'écran d'analyse : par version de script (dans l'ordre des scripts, la plus récente d'abord)
 * et par objection. Les appels simulés sont exclus sauf demande, et toujours comptés à part.
 */
export async function analyseEntreprise(entrepriseId: string, avecSimules: boolean) {
  const [lignes, versions, listeObjections] = await Promise.all([
    db
      .select({
        ligne: appels.ligne,
        versionScriptId: appels.versionScriptId,
        versionAgent: appels.versionAgent,
        issueSysteme: appels.issueSysteme,
        bilan: appels.bilan,
      })
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
      versionAgent: l.versionAgent,
      issueSysteme: l.issueSysteme as IssueSysteme,
      etapeAtteinte: l.bilan?.etapeAtteinte ?? 0,
      objections: l.bilan?.objections ?? [],
    }));
  const parVersion = statistiquesParVersion(retenus).sort(
    (a, b) => versions.findIndex((v) => v.id === a.versionScriptId) - versions.findIndex((v) => v.id === b.versionScriptId),
  );
  // Mêmes chiffres, regroupés par configuration de l'assistante (version de l'agent ElevenLabs) : la mesure qui
  // boucle un réglage du prompt. `versionScriptId` porte ici la version de l'agent, « inconnue » sans elle.
  const parVersionAssistante = statistiquesParVersion(retenus.map((r) => ({ ...r, versionScriptId: r.versionAgent ?? VERSION_AGENT_INCONNUE }))).map(
    ({ versionScriptId, ...chiffres }) => ({ versionAgent: versionScriptId === VERSION_AGENT_INCONNUE ? null : versionScriptId, ...chiffres }),
  );
  return {
    simules,
    parVersion,
    parVersionAssistante,
    parObjection: statistiquesObjections(retenus),
    libelleVersion: (id: string) => versions.find((v) => v.id === id)?.libelle ?? 'Version supprimée',
    libelleObjection: (id: string | null) =>
      id === null ? 'Objections nouvelles (absentes de la fiche)' : (listeObjections.find((o) => o.id === id)?.libelle ?? 'Objection supprimée'),
  };
}

/** Les derniers rendez-vous réservés par l’assistante, avec l'état de leur événement Google. */
export async function rendezVousRecents(limite = 20) {
  return db
    .select({ rdv: rendezVous, prospect: prospects.nom, appelId: appels.id })
    .from(rendezVous)
    .innerJoin(appels, eq(appels.id, rendezVous.appelId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .orderBy(desc(rendezVous.debut))
    .limit(limite);
}

/** Les derniers appels d'outils du serveur MCP (ADR 0009), du plus récent au plus ancien, d'un seul outil si demandé. */
export async function journalMcpRecent(limite = 30, filtres: { outil?: string } = {}) {
  return db
    .select()
    .from(journalMcp)
    .where(filtres.outil ? eq(journalMcp.outil, filtres.outil) : undefined)
    .orderBy(desc(journalMcp.le))
    .limit(limite);
}
