'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { rafraichirSiAncien } from '@/lib/agenda';
import { traiterAppel } from '@/lib/appels';
import {
  appelerSuivantNavigateur,
  appelerSuivantTelephone,
  clore,
  demarrerCampagne,
  derouleSimulation,
  enregistrerCampagne,
  suspendreSiEnCours,
} from '@/lib/campagnes';
import type { EtatFormulaire } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { campagneSchema } from '@/lib/schemas';
import type { DemarrageAppel } from '../appels/actions';

export async function nouvelleCampagne(entrepriseId: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = campagneSchema.safeParse({
    versionScriptId: donnees.get('versionScriptId'),
    ligne: donnees.get('ligne'),
    prospects: donnees.getAll('prospects').map(String),
  });
  if (!saisie.success) return { message: saisie.error.issues[0]?.message ?? 'Saisie invalide.' };

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

export async function ouvrirAppelSuivant(campagneId: string): Promise<DemarrageAppel> {
  await exigerOperateur();
  await rafraichirSiAncien();
  const suivant = await appelerSuivantNavigateur(campagneId);
  if (suivant.type === 'attente') return { ok: false, raison: 'Plus aucun prospect à appeler.' };
  return { ok: true, appelId: suivant.appelId, jeton: suivant.jeton, variables: suivant.variables as never, motsCles: suivant.motsCles };
}

export async function cloreAppelDeCampagne(campagneId: string, appelId: string): Promise<void> {
  await exigerOperateur();
  await db.update(appels).set({ finLe: new Date() }).where(eq(appels.id, appelId));
  await clore(campagneId, appelId);
  after(() => traiterAppel(appelId));
  revalidatePath(`/campagnes/${campagneId}`);
}
