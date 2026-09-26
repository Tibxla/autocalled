'use server';

import { and, eq, max } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ISSUES_SYSTEME } from '@autocalled/domain';
import { db } from '@/db';
import { entreprises, issuesPersonnalisees, objections, scripts, versionsScript } from '@/db/schema';
import { type EtatFormulaire, erreursDeZod } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';

const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const texte = (max: number) => z.string().trim().max(max, `${max} caractères au plus.`);

const ficheSchema = z.object({
  nom: z.string().trim().min(2, 'Deux lettres au moins.').max(80),
  offre: texte(400),
  cible: texte(400),
  arguments: texte(1200),
  prixConsigne: texte(400),
  interdits: texte(600),
  dureeRendezVousMinutes: z.coerce.number().int().min(15).max(120),
  delaiMinimumHeures: z.coerce.number().int().min(0, 'Zéro au moins.').max(168, 'Une semaine au plus.'),
  horizonJours: z.coerce.number().int().min(1, 'Un jour au moins.').max(60, 'Soixante jours au plus.'),
});

export async function enregistrerFiche(
  entrepriseId: string,
  _: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = ficheSchema.safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const plages = [];
  for (const jour of JOURS) {
    if (donnees.get(`jour-${jour}`) !== 'on') continue;
    const debut = String(donnees.get(`debut-${jour}`) ?? '');
    const fin = String(donnees.get(`fin-${jour}`) ?? '');
    if (!HEURE.test(debut) || !HEURE.test(fin) || debut >= fin) {
      return { erreurs: { plages: 'Chaque jour coché a besoin d’une heure de début avant l’heure de fin.' } };
    }
    plages.push({ jour, debut, fin });
  }

  await db
    .update(entreprises)
    .set({ ...saisie.data, plagesRendezVous: plages })
    .where(eq(entreprises.id, entrepriseId));
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: 'Fiche enregistrée.' };
}

const objectionSchema = z.object({
  libelle: z.string().trim().min(2, 'Écris l’objection telle qu’un prospect la dirait.').max(160),
  creuser: texte(600),
  reformuler: texte(600),
  argumenter: texte(600),
  controler: texte(600),
});

export async function enregistrerObjection(
  entrepriseId: string,
  objectionId: string | null,
  _: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = objectionSchema.safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  if (objectionId) {
    await db
      .update(objections)
      .set(saisie.data)
      .where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, entrepriseId)));
  } else {
    const [dernier] = await db
      .select({ ordre: max(objections.ordre) })
      .from(objections)
      .where(eq(objections.entrepriseId, entrepriseId));
    await db.insert(objections).values({ ...saisie.data, entrepriseId, ordre: (dernier?.ordre ?? 0) + 1 });
  }
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: objectionId ? 'Objection enregistrée.' : 'Objection ajoutée.' };
}

/** Une objection n'est jamais supprimée : les bilans passés y font référence. */
export async function basculerArchiveObjection(entrepriseId: string, objectionId: string, archivee: boolean) {
  await exigerOperateur();
  await db
    .update(objections)
    .set({ archivee })
    .where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, entrepriseId)));
  revalidatePath('/entreprises', 'layout');
}

const issueSchema = z.object({
  libelle: z.string().trim().min(2, 'Deux lettres au moins.').max(80),
  issueSysteme: z.enum(ISSUES_SYSTEME, 'Choisis l’issue système à laquelle la rattacher.'),
});

export async function ajouterIssue(entrepriseId: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = issueSchema.safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };
  await db.insert(issuesPersonnalisees).values({ ...saisie.data, entrepriseId });
  revalidatePath('/entreprises', 'layout');
  return { ok: true };
}

export async function basculerArchiveIssue(entrepriseId: string, issueId: string, archivee: boolean) {
  await exigerOperateur();
  await db
    .update(issuesPersonnalisees)
    .set({ archivee })
    .where(and(eq(issuesPersonnalisees.id, issueId), eq(issuesPersonnalisees.entrepriseId, entrepriseId)));
  revalidatePath('/entreprises', 'layout');
}

const ETAPES_INITIALES = [
  { intention: 'Accroche : se présenter et demander deux minutes.', exemples: [] },
  { intention: 'Qualification : comprendre comment le prospect travaille aujourd’hui.', exemples: [] },
  { intention: 'Pitch : relier l’offre à ce qu’il vient de dire, en une phrase.', exemples: [] },
  { intention: 'Rendez-vous : proposer un premier échange.', exemples: [] },
];

export async function creerScript(entrepriseId: string, slug: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = z.object({ nom: z.string().trim().min(2, 'Deux lettres au moins.').max(80) }).safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const scriptId = await db.transaction(async (tx) => {
    const [script] = await tx.insert(scripts).values({ entrepriseId, nom: saisie.data.nom }).returning({ id: scripts.id });
    if (!script) throw new Error('création du script impossible');
    await tx.insert(versionsScript).values({ scriptId: script.id, numero: 1, etapes: ETAPES_INITIALES });
    return script.id;
  });
  redirect(`/entreprises/${slug}/scripts/${scriptId}`);
}

const etapesSchema = z
  .array(
    z.object({
      intention: z.string().trim().min(3, 'Chaque étape a besoin d’une intention.').max(300),
      exemples: z.array(z.string().trim().min(1).max(300)).max(4),
    }),
  )
  .min(1, 'Un script a au moins une étape.')
  .max(10, 'Dix étapes au plus.');

/** Une version est figée : enregistrer des modifications crée la version suivante. */
export async function creerVersion(
  entrepriseId: string,
  scriptId: string,
  _: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  await exigerOperateur();
  const intentions = donnees.getAll('intention').map(String);
  const exemples = donnees.getAll('exemples').map(String);
  const saisie = etapesSchema.safeParse(
    intentions
      .map((intention, i) => ({
        intention,
        exemples: (exemples[i] ?? '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      }))
      .filter((e) => e.intention.trim() || e.exemples.length),
  );
  if (!saisie.success) return { erreurs: { etapes: saisie.error.issues[0]?.message ?? 'Étapes invalides.' } };

  const [script] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.entrepriseId, entrepriseId)));
  if (!script) return { message: 'Ce script n’existe plus.' };

  await db.transaction(async (tx) => {
    const [dernier] = await tx
      .select({ numero: max(versionsScript.numero) })
      .from(versionsScript)
      .where(eq(versionsScript.scriptId, scriptId));
    await tx.insert(versionsScript).values({ scriptId, numero: (dernier?.numero ?? 0) + 1, etapes: saisie.data });
  });
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: 'Nouvelle version enregistrée.' };
}
