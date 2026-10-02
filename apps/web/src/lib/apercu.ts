import 'server-only';
import {
  type Appelabilite,
  bilanEntier,
  ISSUES_SYSTEME,
  LIBELLES_ISSUES,
  VARIABLES_DE_L_APPEL,
  type VariablesDeLAppel,
  variablesDeLAppel,
} from '@autocalled/domain';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, objections, prospects, scripts, versionsScript, type Etape } from '@/db/schema';
import { composerOuverture, composerPremierMessage, lireAssistante } from './assistante';
import { appelabiliteDe } from './appelables';
import { versionsLancables } from './versions';

/**
 * Les variables que l'assistante reçoit au début d'un appel, calculées d'un seul endroit : `preparerAppel` (qui appelle
 * vraiment) et l'aperçu des pages d'entreprise passent par `variablesPour`. L'aperçu n'écrit rien et ne compose
 * rien ; il dit aussi quelles valeurs tombent sur leur texte par défaut, et quels champs vides de la fiche de
 * l'entreprise ne sont pas transmis (variable vide, ADR 0015), ce qui sert à régler la fiche et le prompt.
 */

const libelleIssue = new Map<string, string>(ISSUES_SYSTEME.map((i) => [i, LIBELLES_ISSUES[i]]));

type EntrepriseAppel = typeof entreprises.$inferSelect;
type ProspectAppel = Pick<typeof prospects.$inferSelect, 'id' | 'nom' | 'role' | 'societe' | 'contexte' | 'email'>;
export type CleVariable = (typeof VARIABLES_DE_L_APPEL)[number];

/** Les variables qui viennent des champs de la fiche de l'entreprise : vides, elles ne sont pas transmises. */
export const VARIABLES_DE_LA_FICHE = [
  'entreprise_offre',
  'entreprise_cible',
  'entreprise_arguments',
  'entreprise_prix_consigne',
  'entreprise_interdits',
  'entreprise_complements',
] as const satisfies readonly CleVariable[];

/** Les variables qui viennent de la fiche du prospect ou de ses appels passés. */
export const VARIABLES_DU_PROSPECT: readonly CleVariable[] = [
  'prospect_nom',
  'prospect_role',
  'prospect_societe',
  'prospect_contexte',
  'prospect_email',
  'historique_appels',
];

/** Objections actives de l'entreprise, dans l'ordre donné par l'opérateur (l'identifiant départage les égalités). */
export function objectionsActives(entrepriseId: string) {
  return db
    .select()
    .from(objections)
    .where(and(eq(objections.entrepriseId, entrepriseId), eq(objections.archivee, false)))
    .orderBy(asc(objections.ordre), asc(objections.id));
}

/**
 * Cœur commun à l'appel et à l'aperçu. Sans prospect, les variables du prospect sont calculées sur une fiche vide :
 * l'appelant les présente comme « selon la fiche », jamais comme des valeurs.
 */
export async function variablesPour(
  entreprise: EntrepriseAppel,
  prospect: ProspectAppel | null,
  etapes: Etape[],
  maintenant: Date,
): Promise<{
  variables: VariablesDeLAppel;
  motsCles: string[];
  parDefaut: CleVariable[];
  nonTransmis: CleVariable[];
  premierMessage: string;
  ouverture: string | null;
}> {
  const [assistante, listeObjections, precedents] = await Promise.all([
    lireAssistante(),
    objectionsActives(entreprise.id),
    prospect
      ? db
          .select({ le: appels.debutLe, issue: appels.issue, bilan: appels.bilan })
          .from(appels)
          .where(and(eq(appels.entrepriseId, entreprise.id), eq(appels.prospectId, prospect.id), isNotNull(appels.bilan)))
          .orderBy(desc(appels.debutLe))
          .limit(5)
      : Promise.resolve([]),
  ]);
  const fiche = prospect ?? { nom: '', role: null, societe: null, contexte: '', email: null };

  const variables = variablesDeLAppel({
    assistante: { nom: assistante.nom },
    entreprise,
    prospect: fiche,
    rendezVous: { interlocuteur: entreprise.interlocuteur, dureeMinutes: entreprise.dureeRendezVousMinutes },
    etapes,
    objections: listeObjections,
    historique: precedents.map((p) => ({
      le: p.le,
      issue: libelleIssue.get(p.issue ?? '') ?? p.issue ?? 'issue inconnue',
      // Un bilan purgé (durée de conservation, ADR 0014) n'a plus de résumé : l'issue seule reste.
      resume: bilanEntier(p.bilan)?.resume ?? '',
    })),
    maintenant,
    fuseau: entreprise.fuseau,
  });

  // Noms propres de l'appel, pour que la reconnaissance vocale les entende bien.
  const motsCles = [
    ...new Set(
      [entreprise.nom, ...(prospect ? [prospect.nom, ...prospect.nom.split(/\s+/), prospect.societe] : [])].filter((m): m is string =>
        Boolean(m && m.length > 2),
      ),
    ),
  ].slice(0, 12);

  // Mêmes tests que variablesDeLAppel : champ vide après trim, ou absent pour les champs facultatifs de la fiche.
  const vide = (t: string) => !t.trim();
  const sources: [CleVariable, boolean][] = [
    ['rendez_vous', vide(entreprise.interlocuteur)],
    ['script_etapes', etapes.length === 0],
    ['objections', listeObjections.length === 0],
    ...(prospect
      ? ([
          ['prospect_role', prospect.role == null],
          ['prospect_societe', prospect.societe == null],
          ['prospect_contexte', vide(prospect.contexte)],
          ['prospect_email', prospect.email == null],
        ] as [CleVariable, boolean][])
      : []),
  ];
  return {
    variables,
    motsCles,
    parDefaut: sources.filter(([, d]) => d).map(([cle]) => cle),
    // La variable elle-même dit si le champ est transmis : vide après trim, rien ne part.
    nonTransmis: VARIABLES_DE_LA_FICHE.filter((cle) => !variables[cle]),
    premierMessage: composerPremierMessage(assistante.premierMessage, variables),
    ouverture: composerOuverture(etapes, variables),
  };
}

function refusDe(a: Appelabilite | undefined): RaisonRefus | null {
  if (!a) return 'numero-invalide';
  return a.appelable ? null : a.raison;
}

export interface ApercuVariables {
  variables: VariablesDeLAppel;
  motsCles: string[];
  /** La phrase que l'assistante dira si le prospect se tait au décroché, variables remplacées. */
  premierMessage: string;
  /** Ligne téléphone : la phrase dite juste après un « bonjour » court au décroché (étape 1 du script), sinon null. */
  ouverture: string | null;
  /** Clés dont la valeur est le texte par défaut, faute de contenu (interlocuteur, script, objections, prospect). */
  parDefaut: CleVariable[];
  /** Champs vides de la fiche de l'entreprise : leur variable part vide, l'assistante n'en parle pas. */
  nonTransmis: CleVariable[];
  /** Clés qui dépendent du prospect : vides de sens quand aucun prospect n'est choisi. */
  dependDuProspect: CleVariable[];
  version: { id: string; numero: number; script: string } | null;
  /** `refus` : pourquoi ce numéro ne serait pas composé (null s'il est appelable). */
  prospect: { id: string; nom: string; refus: RaisonRefus | null } | null;
}

type RaisonRefus = Extract<Appelabilite, { appelable: false }>['raison'];

/**
 * Ce que l'assistante recevrait pour appeler un prospect de cette entreprise (ou n'importe lequel, sans prospect) avec
 * une version de script (par défaut la dernière du premier script lançable). Lecture seule : ni appel, ni
 * journal ; un numéro qui ne serait pas composé est signalé, pas refusé.
 */
export async function apercuVariablesAppel(
  entrepriseId: string,
  choix: { prospectId?: string | null; versionScriptId?: string | null; maintenant?: Date } = {},
): Promise<({ ok: true } & ApercuVariables) | { ok: false; raison: string }> {
  const [entreprise] = await db.select().from(entreprises).where(eq(entreprises.id, entrepriseId));
  if (!entreprise) return { ok: false, raison: 'Cette entreprise n’existe plus.' };

  let version: { id: string; numero: number; script: string; etapes: Etape[] } | null = null;
  if (choix.versionScriptId) {
    const [trouvee] = await db
      .select({ id: versionsScript.id, numero: versionsScript.numero, script: scripts.nom, etapes: versionsScript.etapes })
      .from(versionsScript)
      .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
      .where(and(eq(versionsScript.id, choix.versionScriptId), eq(scripts.entrepriseId, entrepriseId)));
    if (!trouvee) return { ok: false, raison: 'Cette version de script n’appartient pas à cette entreprise.' };
    version = trouvee;
  } else {
    const [premiere] = await versionsLancables(entrepriseId);
    if (premiere) {
      const [etapes] = await db.select({ etapes: versionsScript.etapes }).from(versionsScript).where(eq(versionsScript.id, premiere.id));
      version = { id: premiere.id, numero: premiere.numero, script: premiere.script, etapes: etapes?.etapes ?? [] };
    }
  }

  let prospect: (ProspectAppel & { telephone: string }) | null = null;
  if (choix.prospectId) {
    const [trouve] = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, choix.prospectId)));
    if (!trouve) return { ok: false, raison: 'Ce prospect n’existe pas dans cette entreprise.' };
    prospect = trouve;
  }

  const [calcul, verifies] = await Promise.all([
    variablesPour(entreprise, prospect, version?.etapes ?? [], choix.maintenant ?? new Date()),
    prospect ? appelabiliteDe([prospect.telephone]) : Promise.resolve(new Map<string, Appelabilite>()),
  ]);
  return {
    ok: true,
    ...calcul,
    dependDuProspect: [...VARIABLES_DU_PROSPECT],
    version: version ? { id: version.id, numero: version.numero, script: version.script } : null,
    prospect: prospect ? { id: prospect.id, nom: prospect.nom, refus: refusDe(verifies.get(prospect.telephone)) } : null,
  };
}
