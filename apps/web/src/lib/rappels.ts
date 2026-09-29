import 'server-only';
import type { IssueSysteme, RappelDate } from '@autocalled/domain';
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, prospects } from '@/db/schema';

/**
 * Rappels convenus (CONTEXT.md). Un rappel est à faire tant qu'aucun appel plus récent vers le même prospect
 * n'existe : dès qu'on le rappelle, qu'il décroche ou non, le rappel est fait. Les appels simulés n'entrent
 * pas dans la règle : un rappel « convenu » avec un modèle n'est pas à faire, et une simulation ne rappelle
 * personne. LECTURE SEULE.
 */

/** L'appel porte un rappel convenu encore à faire (condition SQL sur `appels`). */
export const RAPPEL_A_FAIRE = sql`(${appels.issueSysteme} = 'rappel-convenu' and ${appels.ligne} <> 'simulation' and not exists (
  select 1 from appels plus_recent
  where plus_recent.entreprise_id = ${appels.entrepriseId}
    and plus_recent.prospect_id = ${appels.prospectId}
    and plus_recent.ligne <> 'simulation'
    and plus_recent.debut_le > ${appels.debutLe}
))`;

const DEBUT_JOUR = sql`(date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')`;
const FIN_JOUR = sql`((date_trunc('day', now() at time zone 'Europe/Paris') + interval '1 day') at time zone 'Europe/Paris')`;

export interface RappelAFaire {
  appelId: string;
  prospectId: string;
  prospect: string;
  societe: string | null;
  entreprise: string;
  entrepriseSlug: string;
  /** L'instant retenu (ISO) : l'heure dite, sinon 9 h le matin et le jour seul, 14 h l'après-midi. */
  rappelLe: string;
  /** Jour, heure ou moment tels que l'analyse les a datés. */
  quand: RappelDate | null;
  /** Le moment tel que le prospect l'a dit. */
  texte: string | null;
  /** Prévu un jour avant aujourd'hui (Paris). */
  enRetard: boolean;
}

/**
 * Les rappels datés à faire aujourd'hui ou en retard, du plus ancien au plus tardif, et le nombre de rappels
 * à faire sans date (le prospect n'a pas donné de moment datable).
 */
export async function rappelsDuJour(): Promise<{ rappels: RappelAFaire[]; sansDate: number }> {
  const [lignes, sansDate] = await Promise.all([
    db
      .select({
        appelId: appels.id,
        prospectId: appels.prospectId,
        prospect: prospects.nom,
        societe: prospects.societe,
        entreprise: entreprises.nom,
        entrepriseSlug: entreprises.slug,
        rappelLe: appels.rappelLe,
        quand: sql<RappelDate | null>`${appels.bilan}->'rappelLe'`,
        texte: sql<string | null>`${appels.bilan}->>'rappel'`,
        enRetard: sql<boolean>`${appels.rappelLe} < ${DEBUT_JOUR}`,
      })
      .from(appels)
      .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
      .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
      .where(and(isNotNull(appels.rappelLe), lt(appels.rappelLe, FIN_JOUR), RAPPEL_A_FAIRE))
      .orderBy(asc(appels.rappelLe), asc(appels.id)),
    db.$count(appels, and(isNull(appels.rappelLe), RAPPEL_A_FAIRE)),
  ]);
  return {
    sansDate,
    rappels: lignes.map((l) => ({
      ...l,
      prospect: l.prospect ?? l.prospectId,
      rappelLe: (l.rappelLe as Date).toISOString(),
      enRetard: Boolean(l.enRetard),
    })),
  };
}

/** Un appel de l'historique d'un prospect, tel que la fiche le lit. */
export interface AppelHistorique {
  id: string;
  ligne: string;
  debutLe: Date;
  issueSysteme: IssueSysteme | null;
  rappelLe: Date | null;
  bilan: { rappel: string | null; rappelLe?: RappelDate | null } | null;
}

/**
 * Le rappel à faire d'un prospect, d'après son historique : son dernier appel hors simulation, s'il a fini en
 * rappel convenu. Tout appel plus récent, même non abouti, le fait.
 */
export function rappelEnAttente(historique: readonly AppelHistorique[]): { appelId: string; rappelLe: Date | null; quand: RappelDate | null; texte: string | null } | null {
  const dernier = historique.filter((a) => a.ligne !== 'simulation').sort((a, b) => b.debutLe.getTime() - a.debutLe.getTime())[0];
  if (dernier?.issueSysteme !== 'rappel-convenu') return null;
  return { appelId: dernier.id, rappelLe: dernier.rappelLe, quand: dernier.bilan?.rappelLe ?? null, texte: dernier.bilan?.rappel ?? null };
}
