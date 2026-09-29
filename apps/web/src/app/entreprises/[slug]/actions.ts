'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import * as entreprise from '@/lib/entreprises';
import { type EtatFormulaire, type ResultatAction, erreursDeZod } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { JOURS, etapesSchema, ficheSchema, issueSchema, nomScriptSchema, objectionSchema, plagesSchema } from '@/lib/schemas';

export async function enregistrerFiche(
  entrepriseId: string,
  _: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = ficheSchema.safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const plages = plagesSchema.safeParse(
    JOURS.filter((jour) => donnees.get(`jour-${jour}`) === 'on').map((jour) => ({
      jour,
      debut: String(donnees.get(`debut-${jour}`) ?? ''),
      fin: String(donnees.get(`fin-${jour}`) ?? ''),
    })),
  );
  if (!plages.success) return { erreurs: { plages: plages.error.issues[0]?.message ?? 'Plages invalides.' } };

  await entreprise.enregistrerFiche(entrepriseId, saisie.data, plages.data);
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: 'Fiche enregistrée.' };
}

export async function enregistrerObjection(
  entrepriseId: string,
  objectionId: string | null,
  _: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = objectionSchema.safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const resultat = await entreprise.enregistrerObjection(entrepriseId, objectionId, saisie.data);
  if (!resultat.ok) return { message: resultat.raison };
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: objectionId ? 'Objection enregistrée.' : 'Objection ajoutée.' };
}

export async function basculerArchiveObjection(
  entrepriseId: string,
  objectionId: string,
  archivee: boolean,
): Promise<ResultatAction<{ archivee: boolean }>> {
  await exigerOperateur();
  if (!(await entreprise.basculerArchiveObjection(entrepriseId, objectionId, archivee))) {
    return { ok: false, raison: 'Cette objection n’existe plus dans cette entreprise.' };
  }
  revalidatePath('/entreprises', 'layout');
  return { ok: true, archivee };
}

export async function ajouterIssue(entrepriseId: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = issueSchema.safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };
  await entreprise.ajouterIssue(entrepriseId, saisie.data);
  revalidatePath('/entreprises', 'layout');
  return { ok: true };
}

export async function basculerArchiveIssue(
  entrepriseId: string,
  issueId: string,
  archivee: boolean,
): Promise<ResultatAction<{ archivee: boolean }>> {
  await exigerOperateur();
  if (!(await entreprise.basculerArchiveIssue(entrepriseId, issueId, archivee))) {
    return { ok: false, raison: 'Cette issue n’existe plus dans cette entreprise.' };
  }
  revalidatePath('/entreprises', 'layout');
  return { ok: true, archivee };
}

export async function creerScript(entrepriseId: string, slug: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = z.object({ nom: nomScriptSchema }).safeParse(Object.fromEntries(donnees));
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const { scriptId } = await entreprise.creerScript(entrepriseId, saisie.data.nom);
  redirect(`/entreprises/${slug}/scripts/${scriptId}`);
}

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

  const version = await entreprise.creerVersion(entrepriseId, scriptId, saisie.data);
  if (!version.ok) return { message: version.raison };
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: 'Nouvelle version enregistrée.' };
}
