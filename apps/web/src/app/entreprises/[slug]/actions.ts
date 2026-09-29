'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { type ApercuVariables, apercuVariablesAppel } from '@/lib/apercu';
import * as entreprise from '@/lib/entreprises';
import { type EtatFormulaire, type ResultatAction, erreursDeZod, jetonConnu } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { JOURS, ficheSchema, issueSchema, nomScriptSchema, objectionSchema, plagesSchema, verifierEtapes } from '@/lib/schemas';

function refusDeFormulaire(refus: entreprise.Refus | entreprise.Conflit): EtatFormulaire {
  return 'conflit' in refus ? { message: refus.raison, conflit: { jeton: refus.conflit.jeton } } : { message: refus.raison };
}

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

  const resultat = await entreprise.enregistrerFiche(entrepriseId, saisie.data, plages.data, { origine: 'interface', connu: jetonConnu(donnees) });
  // Refus ou conflit : pas de revalidation, la saisie reste telle quelle face à la page ouverte.
  if (!resultat.ok) return refusDeFormulaire(resultat);
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

  const resultat = await entreprise.enregistrerObjection(entrepriseId, objectionId, saisie.data, { origine: 'interface', connu: jetonConnu(donnees) });
  if (!resultat.ok) return refusDeFormulaire(resultat);
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: objectionId ? 'Objection enregistrée.' : 'Objection ajoutée.' };
}

export async function basculerArchiveObjection(
  entrepriseId: string,
  objectionId: string,
  archivee: boolean,
): Promise<ResultatAction<{ archivee: boolean }>> {
  await exigerOperateur();
  if (!(await entreprise.basculerArchiveObjection(entrepriseId, objectionId, archivee, 'interface'))) {
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

/**
 * Nouvelle version d'un script depuis l'éditeur. Les étapes vides sont ignorées ; toutes les erreurs sont
 * renvoyées, chacune sous la clé `rang:champ` (rang de l'étape dans le formulaire, à partir de 0), avec la
 * position que voit l'opérateur, et les erreurs de la liste elle-même sous `etapes`.
 */
export async function creerVersion(
  entrepriseId: string,
  scriptId: string,
  _: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  await exigerOperateur();
  const verification = verifierEtapes(donnees.getAll('intention').map(String), donnees.getAll('exemples').map(String));
  if (!verification.ok) return { erreurs: verification.erreurs };

  const version = await entreprise.creerVersion(entrepriseId, scriptId, verification.etapes, { origine: 'interface', connu: jetonConnu(donnees) });
  if (!version.ok) return refusDeFormulaire(version);
  revalidatePath('/entreprises', 'layout');
  return { ok: true, message: 'Nouvelle version enregistrée.' };
}

/** Aperçu des variables d'appel (lecture seule) : rien n'est composé ni enregistré. */
export async function lireApercu(
  entrepriseId: string,
  prospectId: string | null,
  versionScriptId: string | null,
): Promise<ResultatAction<{ apercu: ApercuVariables }>> {
  await exigerOperateur();
  const resultat = await apercuVariablesAppel(entrepriseId, { prospectId, versionScriptId });
  if (!resultat.ok) return resultat;
  const { ok, ...apercu } = resultat;
  return { ok, apercu };
}

/** Monte ou descend une objection d'un rang : l'ordre dans lequel Mina les reçoit. */
export async function deplacerObjection(
  entrepriseId: string,
  objectionId: string,
  sens: 'monter' | 'descendre',
): Promise<ResultatAction<{ position: number }>> {
  await exigerOperateur();
  const resultat = await entreprise.deplacerObjection(entrepriseId, objectionId, sens === 'monter' ? -1 : 1);
  if (!resultat.ok) return resultat;
  revalidatePath('/entreprises', 'layout');
  return { ok: true, position: resultat.position };
}

export async function renommerScript(entrepriseId: string, scriptId: string, nom: string): Promise<ResultatAction<{ nom: string }>> {
  await exigerOperateur();
  const saisie = nomScriptSchema.safeParse(nom);
  if (!saisie.success) return { ok: false, raison: saisie.error.issues[0]?.message ?? 'Nom invalide.' };
  if (!(await entreprise.renommerScript(entrepriseId, scriptId, saisie.data))) return { ok: false, raison: 'Ce script n’existe plus.' };
  revalidatePath('/entreprises', 'layout');
  return { ok: true, nom: saisie.data };
}

export async function basculerArchiveScript(entrepriseId: string, scriptId: string, archive: boolean): Promise<ResultatAction<{ archive: boolean }>> {
  await exigerOperateur();
  if (!(await entreprise.basculerArchiveScript(entrepriseId, scriptId, archive))) return { ok: false, raison: 'Ce script n’existe plus.' };
  revalidatePath('/entreprises', 'layout');
  return { ok: true, archive };
}
