import 'server-only';
import { and, eq, max } from 'drizzle-orm';
import { db } from '@/db';
import { entreprises, issuesPersonnalisees, objections, scripts, versionsScript } from '@/db/schema';
import type { Fiche, Plages, SaisieIssue, SaisieObjection } from './schemas';
import { slugifier } from './slug';

/**
 * Écritures de la configuration d'une entreprise, partagées par les actions de l'interface et le serveur
 * MCP. Les saisies arrivent déjà validées par les schémas de `schemas.ts` ; ici ne restent que les règles
 * qui demandent la base (nom déjà pris, script d'une autre entreprise…).
 */

export type Refus = { ok: false; raison: string };

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

export async function enregistrerFiche(entrepriseId: string, fiche: Fiche, plages: Plages): Promise<void> {
  await db
    .update(entreprises)
    .set({ ...fiche, plagesRendezVous: plages })
    .where(eq(entreprises.id, entrepriseId));
}

/** Crée l'objection (en dernière position) ou modifie celle dont l'identifiant est donné. */
export async function enregistrerObjection(
  entrepriseId: string,
  objectionId: string | null,
  saisie: SaisieObjection,
): Promise<{ ok: true; id: string } | Refus> {
  if (objectionId) {
    const [modifiee] = await db
      .update(objections)
      .set(saisie)
      .where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, entrepriseId)))
      .returning({ id: objections.id });
    return modifiee ? { ok: true, id: modifiee.id } : { ok: false, raison: 'Cette objection n’existe pas dans cette entreprise.' };
  }
  const [dernier] = await db
    .select({ ordre: max(objections.ordre) })
    .from(objections)
    .where(eq(objections.entrepriseId, entrepriseId));
  const [creee] = await db
    .insert(objections)
    .values({ ...saisie, entrepriseId, ordre: (dernier?.ordre ?? 0) + 1 })
    .returning({ id: objections.id });
  if (!creee) throw new Error('création de l’objection impossible');
  return { ok: true, id: creee.id };
}

/** Une objection n'est jamais supprimée : les bilans passés y font référence. Renvoie false si elle n'existe pas. */
export async function basculerArchiveObjection(entrepriseId: string, objectionId: string, archivee: boolean): Promise<boolean> {
  const touchees = await db
    .update(objections)
    .set({ archivee })
    .where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, entrepriseId)))
    .returning({ id: objections.id });
  return touchees.length > 0;
}

export async function ajouterIssue(entrepriseId: string, saisie: SaisieIssue): Promise<string> {
  const [creee] = await db
    .insert(issuesPersonnalisees)
    .values({ ...saisie, entrepriseId })
    .returning({ id: issuesPersonnalisees.id });
  if (!creee) throw new Error('création de l’issue impossible');
  return creee.id;
}

export async function basculerArchiveIssue(entrepriseId: string, issueId: string, archivee: boolean): Promise<boolean> {
  const touchees = await db
    .update(issuesPersonnalisees)
    .set({ archivee })
    .where(and(eq(issuesPersonnalisees.id, issueId), eq(issuesPersonnalisees.entrepriseId, entrepriseId)))
    .returning({ id: issuesPersonnalisees.id });
  return touchees.length > 0;
}

const ETAPES_INITIALES = [
  { intention: 'Accroche : se présenter et demander deux minutes.', exemples: [] },
  { intention: 'Qualification : comprendre comment le prospect travaille aujourd’hui.', exemples: [] },
  { intention: 'Pitch : relier l’offre à ce qu’il vient de dire, en une phrase.', exemples: [] },
  { intention: 'Rendez-vous : proposer un premier échange.', exemples: [] },
];

/** Un script naît avec une version 1 aux quatre étapes de départ. */
export async function creerScript(entrepriseId: string, nom: string): Promise<{ scriptId: string; versionScriptId: string }> {
  return db.transaction(async (tx) => {
    const [script] = await tx.insert(scripts).values({ entrepriseId, nom }).returning({ id: scripts.id });
    if (!script) throw new Error('création du script impossible');
    const [version] = await tx
      .insert(versionsScript)
      .values({ scriptId: script.id, numero: 1, etapes: ETAPES_INITIALES })
      .returning({ id: versionsScript.id });
    if (!version) throw new Error('création de la version impossible');
    return { scriptId: script.id, versionScriptId: version.id };
  });
}

export type Etapes = { intention: string; exemples: string[] }[];

/** Une version est figée : enregistrer des modifications crée la version suivante. */
export async function creerVersion(
  entrepriseId: string,
  scriptId: string,
  etapes: Etapes,
): Promise<{ ok: true; id: string; numero: number } | Refus> {
  const [script] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.entrepriseId, entrepriseId)));
  if (!script) return { ok: false, raison: 'Ce script n’existe plus.' };

  return db.transaction(async (tx) => {
    const [dernier] = await tx
      .select({ numero: max(versionsScript.numero) })
      .from(versionsScript)
      .where(eq(versionsScript.scriptId, scriptId));
    const numero = (dernier?.numero ?? 0) + 1;
    const [version] = await tx.insert(versionsScript).values({ scriptId, numero, etapes }).returning({ id: versionsScript.id });
    if (!version) throw new Error('création de la version impossible');
    return { ok: true as const, id: version.id, numero };
  });
}
