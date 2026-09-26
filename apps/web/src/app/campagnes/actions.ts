'use server';

import { creerCampagne, demarrer, mettreEnPause, TransitionInvalide } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { rafraichirSiAncien } from '@/lib/agenda';
import { traiterAppel } from '@/lib/appels';
import { appelerSuivantNavigateur, avecCampagne, clore, derouleSimulation } from '@/lib/campagnes';
import type { EtatFormulaire } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import type { DemarrageAppel } from '../appels/actions';

const schema = z.object({
  versionScriptId: z.uuid('Choisis une version de script.'),
  ligne: z.enum(['navigateur', 'simulation']),
  prospects: z.array(z.string().min(1)).min(1, 'Choisis au moins un prospect.'),
});

export async function nouvelleCampagne(entrepriseId: string, _: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = schema.safeParse({
    versionScriptId: donnees.get('versionScriptId'),
    ligne: donnees.get('ligne'),
    prospects: donnees.getAll('prospects').map(String),
  });
  if (!saisie.success) return { message: saisie.error.issues[0]?.message ?? 'Saisie invalide.' };

  const campagne = creerCampagne({ id: crypto.randomUUID(), entrepriseId, versionScriptId: saisie.data.versionScriptId, prospectIds: saisie.data.prospects });
  await db.insert(campagnes).values({ ...campagne, ligne: saisie.data.ligne });
  redirect(`/campagnes/${campagne.id}`);
}

export async function lancerCampagne(campagneId: string): Promise<void> {
  await exigerOperateur();
  await avecCampagne(campagneId, async (c) => ({ campagne: demarrer(c), resultat: null }));
  await rafraichirSiAncien();
  const [ligne] = await db.select({ ligne: campagnes.ligne }).from(campagnes).where(eq(campagnes.id, campagneId));
  if (ligne?.ligne === 'simulation') after(() => derouleSimulation(campagneId));
  revalidatePath(`/campagnes/${campagneId}`);
}

export async function suspendreCampagne(campagneId: string): Promise<void> {
  await exigerOperateur();
  try {
    await avecCampagne(campagneId, async (c) => ({ campagne: mettreEnPause(c), resultat: null }));
  } catch (erreur) {
    if (!(erreur instanceof TransitionInvalide)) throw erreur;
  }
  revalidatePath(`/campagnes/${campagneId}`);
}

export async function ouvrirAppelSuivant(campagneId: string): Promise<DemarrageAppel> {
  await exigerOperateur();
  await rafraichirSiAncien();
  const suivant = await appelerSuivantNavigateur(campagneId);
  if (suivant.type === 'attente') return { ok: false, raison: 'Plus aucun prospect à appeler.' };
  return { ok: true, appelId: suivant.appelId, jeton: suivant.jeton, variables: suivant.variables as never };
}

export async function cloreAppelDeCampagne(campagneId: string, appelId: string): Promise<void> {
  await exigerOperateur();
  await db.update(appels).set({ finLe: new Date() }).where(eq(appels.id, appelId));
  await clore(campagneId, appelId);
  after(() => traiterAppel(appelId));
  revalidatePath(`/campagnes/${campagneId}`);
}
