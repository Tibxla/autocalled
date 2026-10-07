'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { rafraichirSiAncien } from '@/lib/agenda';
import { traiterAppel } from '@/lib/appels';
import {
  ajouterALaCampagne,
  appelerSuivantNavigateur,
  appelerSuivantTelephone,
  clore,
  demarrerCampagne,
  derouleSimulation,
  enregistrerCampagne,
  obstacleNouvelleCampagne,
  retirerProspect,
  sauterProspect,
  suspendreSiEnCours,
  supprimerCampagnePrete,
  terminerCampagne,
} from '@/lib/campagnes';
import type { EtatFormulaire, ResultatAction } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { campagneSchema } from '@/lib/schemas';
import type { DemarrageAppel } from '../appels/actions';

const uuid = z.uuid();

export async function supprimerCampagne(campagneId: string, confirmee: boolean): Promise<ResultatAction> {
  await exigerOperateur();
  if (confirmee !== true) return { ok: false, raison: 'Confirme la suppression de la campagne.' };
  const resultat = await supprimerCampagnePrete(campagneId);
  if (resultat.ok) {
    revalidatePath(`/campagnes/${campagneId}`);
    revalidatePath('/entreprises', 'layout');
  }
  return resultat;
}

export async function nouvelleCampagne(entrepriseId: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = campagneSchema.safeParse({
    versionScriptId: donnees.get('versionScriptId'),
    ligne: donnees.get('ligne'),
    prospects: donnees.getAll('prospects').map(String),
  });
  if (!saisie.success) return { message: saisie.error.issues[0]?.message ?? 'Saisie invalide.' };
  // Mêmes contrôles que le MCP : un onglet resté ouvert peut proposer un script archivé depuis.
  const obstacle = await obstacleNouvelleCampagne(entrepriseId, saisie.data);
  if (obstacle) return { message: obstacle };

  const campagneId = await enregistrerCampagne(entrepriseId, saisie.data);
  redirect(`/campagnes/${campagneId}`);
}

export async function lancerCampagne(campagneId: string): Promise<void> {
  await exigerOperateur();
  const ligne = await demarrerCampagne(campagneId);
  if (ligne === 'simulation') after(() => derouleSimulation(campagneId));
  if (ligne === 'bluetooth') after(() => appelerSuivantTelephone(campagneId));
  revalidatePath(`/campagnes/${campagneId}`);
}

export async function suspendreCampagne(campagneId: string): Promise<void> {
  await exigerOperateur();
  await suspendreSiEnCours(campagneId);
  revalidatePath(`/campagnes/${campagneId}`);
}

/** `attendu` : le prospect que la régie affiche ; si la file a changé entre-temps, rien ne part. */
export async function ouvrirAppelSuivant(campagneId: string, attendu?: string): Promise<DemarrageAppel> {
  await exigerOperateur();
  await rafraichirSiAncien();
  const suivant = await appelerSuivantNavigateur(campagneId, attendu);
  if (suivant.type === 'attente') return { ok: false, raison: suivant.raison ?? 'Plus aucun prospect à appeler.' };
  return { ok: true, appelId: suivant.appelId, jeton: suivant.jeton, variables: suivant.variables as never, motsCles: suivant.motsCles };
}

export async function cloreAppelDeCampagne(campagneId: string, appelId: string): Promise<void> {
  await exigerOperateur();
  if (!uuid.safeParse(campagneId).success || !uuid.safeParse(appelId).success) throw new Error('identifiant invalide');
  // Seul un appel de cette campagne, pas encore clos, reçoit son heure de fin et part à l'analyse.
  const clos = await db
    .update(appels)
    .set({ finLe: new Date() })
    .where(and(eq(appels.id, appelId), eq(appels.campagneId, campagneId), isNull(appels.finLe)))
    .returning({ id: appels.id });
  await clore(campagneId, appelId);
  if (clos.length) after(() => traiterAppel(appelId));
  revalidatePath(`/campagnes/${campagneId}`);
}

/* Gestes sur la file : aucun n'appelle personne. Une campagne en cours enchaîne ensuite comme d'habitude. */

export async function sauterDansLaFile(campagneId: string, prospectId: string): Promise<ResultatAction> {
  await exigerOperateur();
  const resultat = await sauterProspect(campagneId, prospectId);
  revalidatePath(`/campagnes/${campagneId}`);
  return resultat;
}

export async function retirerDeLaFile(campagneId: string, prospectId: string): Promise<ResultatAction<{ terminee: boolean }>> {
  await exigerOperateur();
  const resultat = await retirerProspect(campagneId, prospectId);
  revalidatePath(`/campagnes/${campagneId}`);
  return resultat;
}

export async function ajouterDansLaFile(campagneId: string, prospectIds: string[]): Promise<ResultatAction<{ ajoutes: number }>> {
  await exigerOperateur();
  if (!Array.isArray(prospectIds) || prospectIds.some((id) => typeof id !== 'string' || id === '')) {
    return { ok: false, raison: 'Choisis au moins un prospect.' };
  }
  const resultat = await ajouterALaCampagne(campagneId, prospectIds);
  revalidatePath(`/campagnes/${campagneId}`);
  return resultat;
}

export async function terminerAvantLaFin(campagneId: string): Promise<ResultatAction<{ fin: 'immediate' | 'apres-appel' }>> {
  await exigerOperateur();
  const resultat = await terminerCampagne(campagneId);
  revalidatePath(`/campagnes/${campagneId}`);
  return resultat;
}
