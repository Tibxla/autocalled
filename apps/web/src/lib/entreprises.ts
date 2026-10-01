import 'server-only';
import { etapesIdentiques } from '@autocalled/domain';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { cleJour, heure, jourCourt } from '@/components/format-appel';
import { db } from '@/db';
import { appels, campagnes, entreprises, imports, issuesPersonnalisees, objections, type Origine, prospects, scripts, versionsScript } from '@/db/schema';
import type { Fiche, Plages, SaisieIssue, SaisieObjection } from './schemas';
import { slugifier } from './slug';

/**
 * Écritures de la configuration d'une entreprise, partagées par les actions de l'interface et le serveur
 * MCP. Les saisies arrivent déjà validées par les schémas de `schemas.ts` ; ici ne restent que les règles
 * qui demandent la base (nom déjà pris, script d'une autre entreprise…).
 */

export type Refus = { ok: false; raison: string };

/**
 * Qui écrit, et ce qu'il avait sous les yeux. `connu` est l'horodatage de dernière modification lu à l'ouverture
 * du formulaire (ISO), ou pour une version le numéro de la dernière version : s'il a changé depuis, l'écriture
 * est refusée (`Conflit`). Absent, rien n'est contrôlé : c'est le cas du serveur MCP.
 */
export interface Ecriture {
  origine: Origine;
  connu?: string | null;
}

/**
 * Sans précision, l'écriture est attribuée au serveur MCP. Défaut gardé pour la compatibilité seulement : le MCP
 * et l'interface passent désormais toujours leur origine en clair.
 */
const PAR_MCP: Ecriture = { origine: 'mcp' };

/** Refus d'une écriture concurrente. `jeton` est la valeur de `connu` qui permet d'écraser en connaissance de cause. */
export type Conflit = Refus & { conflit: { le: Date; origine: Origine | null; jeton: string } };

const AUTEUR: Record<Origine, string> = { mcp: 'par Claude Code', interface: 'dans une autre fenêtre' };

/** « à 14:02 » le jour même, « le mar. 29/09 à 14:02 » sinon. */
function moment(le: Date, maintenant = new Date()): string {
  return cleJour(le) === cleJour(maintenant) ? `à ${heure(le)}` : `le ${jourCourt(le)} à ${heure(le)}`;
}

/** « Modifiée par Claude Code à 14:02 », « modifiée ailleurs à 14:02 » quand l'origine n'est pas connue. */
export function auteurEtMoment(le: Date, origine: Origine | null): string {
  return `${origine ? AUTEUR[origine] : 'ailleurs'} ${moment(le)}`;
}

function conflitSi(connu: string | null | undefined, actuel: { modifieLe: Date; modifiePar: Origine | null }, sujet: string): Conflit | null {
  if (connu == null || Date.parse(connu) === actuel.modifieLe.getTime()) return null;
  return {
    ok: false,
    raison: `${sujet} ${auteurEtMoment(actuel.modifieLe, actuel.modifiePar)}, depuis que tu l’as ouverte.`,
    conflit: { le: actuel.modifieLe, origine: actuel.modifiePar, jeton: actuel.modifieLe.toISOString() },
  };
}

type Lecteur = Pick<typeof db, 'select' | '$count'>;

/** Ce qu'une entreprise contient : son historique (qui empêche de la supprimer) et sa configuration. */
export async function contenuEntreprise(entrepriseId: string, lecteur: Lecteur = db) {
  const idsScripts = lecteur.select({ id: scripts.id }).from(scripts).where(eq(scripts.entrepriseId, entrepriseId));
  const [prospectsN, importsN, appelsN, campagnesN, objectionsN, issuesN, scriptsN, versionsN] = await Promise.all([
    lecteur.$count(prospects, eq(prospects.entrepriseId, entrepriseId)),
    lecteur.$count(imports, eq(imports.entrepriseId, entrepriseId)),
    lecteur.$count(appels, eq(appels.entrepriseId, entrepriseId)),
    lecteur.$count(campagnes, eq(campagnes.entrepriseId, entrepriseId)),
    lecteur.$count(objections, eq(objections.entrepriseId, entrepriseId)),
    lecteur.$count(issuesPersonnalisees, eq(issuesPersonnalisees.entrepriseId, entrepriseId)),
    lecteur.$count(scripts, eq(scripts.entrepriseId, entrepriseId)),
    lecteur.$count(versionsScript, inArray(versionsScript.scriptId, idsScripts)),
  ]);
  return {
    historique: { prospects: prospectsN, imports: importsN, appels: appelsN, campagnes: campagnesN },
    configuration: { objections: objectionsN, issues: issuesN, scripts: scriptsN, versions: versionsN },
  };
}

/** Pourquoi cette entreprise ne se supprime pas (elle a un historique), ou null. */
export function obstacleSuppressionEntreprise(contenu: Awaited<ReturnType<typeof contenuEntreprise>>): string | null {
  const h = contenu.historique;
  const bloquants = [
    h.prospects && `${h.prospects} prospect${h.prospects > 1 ? 's' : ''}`,
    h.imports && `${h.imports} import${h.imports > 1 ? 's' : ''}`,
    h.appels && `${h.appels} appel${h.appels > 1 ? 's' : ''}`,
    h.campagnes && `${h.campagnes} campagne${h.campagnes > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return bloquants.length
    ? `Cette entreprise a un historique (${bloquants.join(', ')}) : elle ne se supprime pas. Seule une entreprise vide, créée par erreur, se supprime.`
    : null;
}

/**
 * Supprime une entreprise créée par erreur, avec sa fiche, ses objections, ses issues personnalisées, ses scripts et
 * leurs versions. Refusée dès qu'elle a un prospect, un import, un appel ou une
 * campagne : c'est de l'historique. L'appelant obtient l'accord de l'opérateur avant : rien ne se récupère.
 */
export async function supprimerEntrepriseVide(
  entrepriseId: string,
): Promise<{ ok: true; supprime: { objections: number; issues: number; scripts: number; versions: number } } | Refus> {
  return db.transaction(async (tx) => {
    const [e] = await tx.select({ id: entreprises.id }).from(entreprises).where(eq(entreprises.id, entrepriseId)).for('update');
    if (!e) return { ok: false as const, raison: 'Cette entreprise n’existe plus.' };
    const contenu = await contenuEntreprise(entrepriseId, tx);
    const obstacle = obstacleSuppressionEntreprise(contenu);
    if (obstacle) return { ok: false as const, raison: obstacle };
    // Les objections, issues, scripts et versions partent en cascade.
    await tx.delete(entreprises).where(eq(entreprises.id, entrepriseId));
    return { ok: true as const, supprime: contenu.configuration };
  });
}

export async function creerEntreprise(nom: string): Promise<{ ok: true; id: string; slug: string } | Refus> {
  const slug = slugifier(nom);
  if (!slug) return { ok: false, raison: 'Le nom doit contenir au moins une lettre ou un chiffre.' };
  const [creee] = await db
    .insert(entreprises)
    .values({ nom, slug })
    .onConflictDoNothing({ target: entreprises.slug })
    .returning({ id: entreprises.id, slug: entreprises.slug });
  if (!creee) return { ok: false, raison: 'Une entreprise porte déjà ce nom.' };
  return { ok: true, ...creee };
}

/** Enregistre la fiche, sauf si elle a changé depuis `ecriture.connu` (formulaire ouvert avant une autre écriture). */
export async function enregistrerFiche(
  entrepriseId: string,
  fiche: Fiche,
  plages: Plages,
  ecriture: Ecriture = PAR_MCP,
): Promise<{ ok: true; modifieLe: Date } | Refus | Conflit> {
  return db.transaction(async (tx) => {
    const [actuelle] = await tx
      .select({ modifieLe: entreprises.modifieLe, modifiePar: entreprises.modifiePar })
      .from(entreprises)
      .where(eq(entreprises.id, entrepriseId))
      .for('update');
    if (!actuelle) return { ok: false as const, raison: 'Cette entreprise n’existe plus.' };
    const conflit = conflitSi(ecriture.connu, actuelle, 'Fiche modifiée');
    if (conflit) return conflit;
    const modifieLe = new Date();
    await tx
      .update(entreprises)
      .set({ ...fiche, plagesRendezVous: plages, modifieLe, modifiePar: ecriture.origine })
      .where(eq(entreprises.id, entrepriseId));
    return { ok: true as const, modifieLe };
  });
}

/**
 * Crée l'objection (en dernière position) ou modifie celle dont l'identifiant est donné, sauf si elle a changé
 * depuis `ecriture.connu`.
 */
export async function enregistrerObjection(
  entrepriseId: string,
  objectionId: string | null,
  saisie: SaisieObjection,
  ecriture: Ecriture = PAR_MCP,
): Promise<{ ok: true; id: string } | Refus | Conflit> {
  if (objectionId) {
    return db.transaction(async (tx) => {
      const [actuelle] = await tx
        .select({ modifieLe: objections.modifieLe, modifiePar: objections.modifiePar })
        .from(objections)
        .where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, entrepriseId)))
        .for('update');
      if (!actuelle) return { ok: false as const, raison: 'Cette objection n’existe pas dans cette entreprise.' };
      const conflit = conflitSi(ecriture.connu, actuelle, 'Objection modifiée');
      if (conflit) return conflit;
      await tx
        .update(objections)
        .set({ ...saisie, modifieLe: new Date(), modifiePar: ecriture.origine })
        .where(eq(objections.id, objectionId));
      return { ok: true as const, id: objectionId };
    });
  }
  const [dernier] = await db
    .select({ ordre: max(objections.ordre) })
    .from(objections)
    .where(eq(objections.entrepriseId, entrepriseId));
  const [creee] = await db
    .insert(objections)
    .values({ ...saisie, entrepriseId, ordre: (dernier?.ordre ?? 0) + 1, modifiePar: ecriture.origine })
    .returning({ id: objections.id });
  if (!creee) throw new Error('création de l’objection impossible');
  return { ok: true, id: creee.id };
}

/**
 * Une objection n'est jamais supprimée : les bilans passés y font référence. Renvoie false si elle n'existe pas.
 * L'archivage compte comme une modification (un formulaire ouvert avant ne l'écrase pas sans le dire).
 */
export async function basculerArchiveObjection(
  entrepriseId: string,
  objectionId: string,
  archivee: boolean,
  origine: Origine = PAR_MCP.origine,
): Promise<boolean> {
  const touchees = await db
    .update(objections)
    .set({ archivee, modifieLe: new Date(), modifiePar: origine })
    .where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, entrepriseId)))
    .returning({ id: objections.id });
  return touchees.length > 0;
}

/**
 * Monte (-1) ou descend (+1) une objection d'un rang parmi les objections actives : c'est l'ordre dans lequel
 * l’assistante les reçoit. Toute la liste est renumérotée de 1 à n (les archivées gardent leur place relative). Le
 * réordonnancement ne compte pas comme une modification de l'objection (`modifieLe` inchangé) : l'opérateur
 * ne doit pas entrer en conflit avec son propre formulaire ouvert. Renvoie la nouvelle position (à partir de 1).
 */
export async function deplacerObjection(entrepriseId: string, objectionId: string, sens: -1 | 1): Promise<{ ok: true; position: number } | Refus> {
  return db.transaction(async (tx) => {
    const liste = await tx
      .select({ id: objections.id, ordre: objections.ordre, archivee: objections.archivee })
      .from(objections)
      .where(eq(objections.entrepriseId, entrepriseId))
      .orderBy(asc(objections.ordre), asc(objections.id))
      .for('update');
    const actives = liste.filter((o) => !o.archivee);
    const rang = actives.findIndex((o) => o.id === objectionId);
    if (rang < 0) {
      return {
        ok: false as const,
        raison: liste.some((o) => o.id === objectionId) ? 'Une objection archivée n’a pas de rang : réactive-la d’abord.' : 'Cette objection n’existe pas dans cette entreprise.',
      };
    }
    const voisine = actives[rang + sens];
    if (!voisine) return { ok: true as const, position: rang + 1 };

    const ici = liste.findIndex((o) => o.id === objectionId);
    const la = liste.findIndex((o) => o.id === voisine.id);
    const nouvelle = [...liste];
    [nouvelle[ici], nouvelle[la]] = [nouvelle[la]!, nouvelle[ici]!];
    for (const [i, o] of nouvelle.entries()) {
      if (o.ordre !== i + 1) await tx.update(objections).set({ ordre: i + 1 }).where(eq(objections.id, o.id));
    }
    return { ok: true as const, position: rang + 1 + sens };
  });
}

/**
 * Donne tout l'ordre des objections actives d'un coup : `ids` doit être exactement l'ensemble des objections actives
 * de l'entreprise. Les archivées passent après, dans leur ordre relatif. Comme `deplacerObjection`, l'ordre ne
 * compte pas comme une modification de l'objection (`modifieLe` inchangé).
 */
export async function ordonnerObjections(entrepriseId: string, ids: readonly string[]): Promise<{ ok: true } | Refus> {
  return db.transaction(async (tx) => {
    const liste = await tx
      .select({ id: objections.id, ordre: objections.ordre, archivee: objections.archivee })
      .from(objections)
      .where(eq(objections.entrepriseId, entrepriseId))
      .orderBy(asc(objections.ordre), asc(objections.id))
      .for('update');
    const actives = liste.filter((o) => !o.archivee);
    if (new Set(ids).size !== ids.length) return { ok: false as const, raison: 'Une objection apparaît deux fois dans l’ordre donné.' };
    const inconnues = ids.filter((id) => !actives.some((o) => o.id === id));
    const oubliees = actives.filter((o) => !ids.includes(o.id));
    if (inconnues.length || oubliees.length) {
      return {
        ok: false as const,
        raison: `L’ordre doit contenir exactement les ${actives.length} objections actives de l’entreprise${
          inconnues.length ? ` (inconnues ou archivées : ${inconnues.join(', ')})` : ''
        }${oubliees.length ? ` (manquantes : ${oubliees.map((o) => o.id).join(', ')})` : ''}.`,
      };
    }
    const nouvelle = [...ids, ...liste.filter((o) => o.archivee).map((o) => o.id)];
    for (const [i, id] of nouvelle.entries()) {
      if (liste.find((o) => o.id === id)?.ordre !== i + 1) await tx.update(objections).set({ ordre: i + 1 }).where(eq(objections.id, id));
    }
    return { ok: true as const };
  });
}

export async function ajouterIssue(entrepriseId: string, saisie: SaisieIssue): Promise<string> {
  const [creee] = await db
    .insert(issuesPersonnalisees)
    .values({ ...saisie, entrepriseId })
    .returning({ id: issuesPersonnalisees.id });
  if (!creee) throw new Error('création de l’issue impossible');
  return creee.id;
}

/**
 * Corrige le libellé d'une issue personnalisée. Son issue système de rattachement reste figée : les chiffres passés
 * seraient réécrits. False si elle n'existe pas dans cette entreprise.
 */
export async function renommerIssue(entrepriseId: string, issueId: string, libelle: string): Promise<boolean> {
  const touchees = await db
    .update(issuesPersonnalisees)
    .set({ libelle })
    .where(and(eq(issuesPersonnalisees.id, issueId), eq(issuesPersonnalisees.entrepriseId, entrepriseId)))
    .returning({ id: issuesPersonnalisees.id });
  return touchees.length > 0;
}

export async function basculerArchiveIssue(entrepriseId: string, issueId: string, archivee: boolean): Promise<boolean> {
  const touchees = await db
    .update(issuesPersonnalisees)
    .set({ archivee })
    .where(and(eq(issuesPersonnalisees.id, issueId), eq(issuesPersonnalisees.entrepriseId, entrepriseId)))
    .returning({ id: issuesPersonnalisees.id });
  return touchees.length > 0;
}

export const ETAPES_INITIALES: Etapes = [
  { intention: 'Accroche : se présenter et demander deux minutes.', exemples: [] },
  { intention: 'Qualification : comprendre comment le prospect travaille aujourd’hui.', exemples: [] },
  { intention: 'Pitch : relier l’offre à ce qu’il vient de dire, en une phrase.', exemples: [] },
  { intention: 'Rendez-vous : proposer un premier échange.', exemples: [] },
];

/**
 * Un script naît avec une version 1 : les étapes données, sinon les quatre intentions de départ que l'éditeur de
 * l'interface ouvre aussitôt. Le serveur MCP donne toujours ses étapes (pas de script de base généré).
 */
export async function creerScript(
  entrepriseId: string,
  nom: string,
  etapes: Etapes = ETAPES_INITIALES,
  origine: Origine | null = null,
): Promise<{ scriptId: string; versionScriptId: string }> {
  return db.transaction(async (tx) => {
    const [script] = await tx.insert(scripts).values({ entrepriseId, nom }).returning({ id: scripts.id });
    if (!script) throw new Error('création du script impossible');
    const [version] = await tx
      .insert(versionsScript)
      .values({ scriptId: script.id, numero: 1, etapes, creePar: origine })
      .returning({ id: versionsScript.id });
    if (!version) throw new Error('création de la version impossible');
    return { scriptId: script.id, versionScriptId: version.id };
  });
}

/** Renomme un script ; ses versions, ses appels et ses campagnes le suivent. False s'il n'existe pas. */
export async function renommerScript(entrepriseId: string, scriptId: string, nom: string): Promise<boolean> {
  const touches = await db
    .update(scripts)
    .set({ nom })
    .where(and(eq(scripts.id, scriptId), eq(scripts.entrepriseId, entrepriseId)))
    .returning({ id: scripts.id });
  return touches.length > 0;
}

/**
 * Un script archivé sort des choix de lancement (appel, campagne) ; il garde ses versions et ses appels, et une
 * campagne déjà lancée garde sa version. False s'il n'existe pas.
 */
export async function basculerArchiveScript(entrepriseId: string, scriptId: string, archive: boolean): Promise<boolean> {
  const touches = await db
    .update(scripts)
    .set({ archive })
    .where(and(eq(scripts.id, scriptId), eq(scripts.entrepriseId, entrepriseId)))
    .returning({ id: scripts.id });
  return touches.length > 0;
}

export type Etapes = { intention: string; exemples: string[] }[];

/**
 * Une version est figée : enregistrer des modifications crée la version suivante. Des étapes identiques à la
 * dernière version sont refusées : deux versions pareilles couperaient l'échantillon de l'analyse en deux.
 * `ecriture.connu` est le numéro de la dernière version que l'éditeur connaissait : si une autre est arrivée
 * depuis, rien n'est créé (`Conflit`, dont le jeton est le numéro de cette nouvelle dernière version).
 */
export async function creerVersion(
  entrepriseId: string,
  scriptId: string,
  etapes: Etapes,
  ecriture: Ecriture = PAR_MCP,
): Promise<{ ok: true; id: string; numero: number } | Refus | Conflit> {
  return db.transaction(async (tx) => {
    // Verrou sur le script : deux créations simultanées passent l'une après l'autre.
    const [script] = await tx
      .select({ id: scripts.id })
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.entrepriseId, entrepriseId)))
      .for('update');
    if (!script) return { ok: false as const, raison: 'Ce script n’existe plus.' };

    const [derniere] = await tx
      .select({ numero: versionsScript.numero, etapes: versionsScript.etapes, creeLe: versionsScript.creeLe, creePar: versionsScript.creePar })
      .from(versionsScript)
      .where(eq(versionsScript.scriptId, scriptId))
      .orderBy(desc(versionsScript.numero))
      .limit(1);
    if (ecriture.connu != null && derniere && String(derniere.numero) !== ecriture.connu) {
      return {
        ok: false as const,
        raison: `Une v${derniere.numero} a été créée ${auteurEtMoment(derniere.creeLe, derniere.creePar)}, depuis que tu as ouvert l’éditeur.`,
        conflit: { le: derniere.creeLe, origine: derniere.creePar, jeton: String(derniere.numero) },
      };
    }
    if (derniere && etapesIdentiques(derniere.etapes, etapes)) {
      return { ok: false as const, raison: `Ces étapes sont celles de la version ${derniere.numero} : rien n’a été enregistré.` };
    }
    const numero = (derniere?.numero ?? 0) + 1;
    const [version] = await tx
      .insert(versionsScript)
      .values({ scriptId, numero, etapes, creePar: ecriture.origine })
      .returning({ id: versionsScript.id });
    if (!version) throw new Error('création de la version impossible');
    return { ok: true as const, id: version.id, numero };
  });
}
