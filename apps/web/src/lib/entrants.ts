import 'server-only';
import { normaliserNumero, type IssueSysteme, type VariablesDeLAppel } from '@autocalled/domain';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, prospects, versionsScript } from '@/db/schema';
import { rafraichirSiAncien } from './agenda';
import { variablesPour } from './apercu';
import { appelabiliteDe } from './appelables';
import { composerPremierMessage } from './assistante';
import { lireReglagesEntrants } from './reglages-entrants';

/**
 * Appels entrants (ADR 0018) : un prospect rappelle le téléphone passerelle. Le pont demande à l'application s'il
 * décroche ; seul un prospect déjà appelé pour de vrai est pris, et rien n'est écrit pour un numéro inconnu.
 */

/** Les lignes où un téléphone sonne vraiment chez le prospect : la ligne navigateur et la simulation n'appellent personne. */
const LIGNES_REELLES = ['bluetooth', 'twilio'] as const;

/**
 * Au-delà, un appel téléphone resté « en cours » en base est tenu pour orphelin (pont redémarré, réponse au pont
 * perdue) : il ne bloque plus les appels entrants. Une heure : la plus longue prise de main de l'opérateur.
 */
const APPEL_EN_COURS_MAX = sql`interval '1 hour'`;

export type DecisionEntrant =
  | { decrocher: false }
  | { decrocher: true; appelId: string; variables: VariablesDeLAppel; motsCles: string[]; premierMessage: string };

const NE_PAS_DECROCHER = { decrocher: false } as const;

/**
 * Qui appelle qui, pour l'assistante d'un appel entrant : le prospect rappelle après le dernier appel sortant vers lui.
 * Sans accord de genre (on ne connaît pas celui du prospect) et sans date absolue quand « aujourd'hui » ou « hier »
 * suffit, dans le fuseau de l'entreprise.
 */
export function situationEntrant(params: {
  nom: string;
  dernierAppel: { le: Date; issueSysteme: IssueSysteme | null };
  maintenant: Date;
  fuseau: string;
}): string {
  const jour = (d: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: params.fuseau }).format(d);
  const veille = new Date(`${jour(params.maintenant)}T12:00:00Z`);
  veille.setUTCDate(veille.getUTCDate() - 1);
  const le = jour(params.dernierAppel.le);
  const quand =
    le === jour(params.maintenant)
      ? "d'aujourd'hui"
      : le === veille.toISOString().slice(0, 10)
        ? "d'hier"
        : `du ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: params.fuseau }).format(params.dernierAppel.le)}`;
  const sansReponse = params.dernierAppel.issueSysteme === 'non-abouti' ? ', resté sans réponse' : '';
  return `C'est ${params.nom} qui te rappelle, après ton appel ${quand}${sansReponse}. Tu viens de décrocher en te présentant : remercie pour ce rappel, puis reprends ton plan là où il en est. C'est lui qui appelle : ne demande pas de minutes ni la permission de parler, donne directement la raison de ton appel.`;
}

/**
 * Décide d'un appel entrant, d'après le numéro brut de l'appelant (oFono). Décroche seulement un prospect non archivé,
 * dont le numéro est appelable (hors liste d'opposition) et qui a déjà reçu un vrai appel sortant ; plusieurs prospects
 * sur ce numéro (plusieurs entreprises) : celui appelé le plus récemment. Dans ce cas seulement, l'appel est enregistré
 * (sens entrant, sans campagne, version du script du dernier appel sortant) avant de répondre au pont. Numéro masqué,
 * illisible ou inconnu, ou ligne déjà occupée en base : on laisse sonner, et rien n'est écrit.
 */
export async function deciderEntrant(brut: unknown, maintenant = new Date()): Promise<DecisionEntrant> {
  const { valeur: reglages, empreinte } = await lireReglagesEntrants();
  if (!reglages.actif) return NE_PAS_DECROCHER;
  const numero = typeof brut === 'string' ? normaliserNumero(brut) : null;
  if (!numero) return NE_PAS_DECROCHER;
  if (!(await appelabiliteDe([numero])).get(numero)?.appelable) return NE_PAS_DECROCHER;

  // Le prospect de ce numéro dont le dernier vrai appel sortant est le plus récent.
  const [trouve] = await db
    .select({ entrepriseId: prospects.entrepriseId, prospectId: prospects.id })
    .from(prospects)
    .innerJoin(appels, and(eq(appels.entrepriseId, prospects.entrepriseId), eq(appels.prospectId, prospects.id)))
    .where(and(eq(prospects.telephone, numero), isNull(prospects.archiveLe), eq(appels.sens, 'sortant'), inArray(appels.ligne, LIGNES_REELLES)))
    .groupBy(prospects.entrepriseId, prospects.id)
    .orderBy(desc(sql`max(${appels.debutLe})`))
    .limit(1);
  if (!trouve) return NE_PAS_DECROCHER;

  // Une seule ligne téléphone : un appel déjà en cours en base (le pont ne l'a pas encore vu) ne se double pas.
  const [enCours] = await db
    .select({ id: appels.id })
    .from(appels)
    .where(and(eq(appels.ligne, 'bluetooth'), eq(appels.statut, 'en-cours'), gt(appels.debutLe, sql`now() - ${APPEL_EN_COURS_MAX}`)))
    .limit(1);
  if (enCours) return NE_PAS_DECROCHER;

  const [dernier] = await db
    .select({ versionScriptId: appels.versionScriptId, le: appels.debutLe, issueSysteme: appels.issueSysteme })
    .from(appels)
    .where(
      and(
        eq(appels.entrepriseId, trouve.entrepriseId),
        eq(appels.prospectId, trouve.prospectId),
        eq(appels.sens, 'sortant'),
        inArray(appels.ligne, LIGNES_REELLES),
      ),
    )
    .orderBy(desc(appels.debutLe))
    .limit(1);
  const [[entreprise], [prospect]] = await Promise.all([
    db.select().from(entreprises).where(eq(entreprises.id, trouve.entrepriseId)),
    db
      .select()
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, trouve.entrepriseId), eq(prospects.id, trouve.prospectId))),
  ]);
  const [version] = dernier ? await db.select({ etapes: versionsScript.etapes }).from(versionsScript).where(eq(versionsScript.id, dernier.versionScriptId)) : [];
  if (!dernier || !entreprise || !prospect || !version) return NE_PAS_DECROCHER;

  const situation = situationEntrant({ nom: prospect.nom, dernierAppel: dernier, maintenant, fuseau: entreprise.fuseau });
  const { variables, motsCles } = await variablesPour(entreprise, prospect, version.etapes, maintenant, { situation });
  // Comme avant un appel sortant : une copie d'agenda trop vieille est relue en tâche de fond, sans retarder le décroché.
  await rafraichirSiAncien();
  // L’opérateur a pu suspendre le décroché ou changer l’accueil pendant la préparation.
  if ((await lireReglagesEntrants()).empreinte !== empreinte) return NE_PAS_DECROCHER;
  const [appel] = await db
    .insert(appels)
    .values({
      entrepriseId: entreprise.id,
      prospectId: prospect.id,
      versionScriptId: dernier.versionScriptId,
      campagneId: null,
      ligne: 'bluetooth',
      sens: 'entrant',
      numero,
      assistanteNom: variables.assistante_nom,
    })
    .returning({ id: appels.id });
  if (!appel) return NE_PAS_DECROCHER;
  return { decrocher: true, appelId: appel.id, variables, motsCles, premierMessage: composerPremierMessage(reglages.accueil, variables) };
}
