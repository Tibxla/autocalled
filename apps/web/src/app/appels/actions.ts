'use server';

import type { VariablesDeLAppel } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { analyserAppel, preparerAppel, simulerAppel, traiterAppel } from '@/lib/appels';
import { rafraichirSiAncien } from '@/lib/agenda';
import { jetonConversation } from '@/lib/elevenlabs';
import { exigerOperateur } from '@/lib/garde';
import { commanderPont } from '@/lib/pont';

export type DemarrageAppel =
  | { ok: true; appelId: string; jeton: string; variables: VariablesDeLAppel; motsCles: string[] }
  | { ok: false; raison: string };

/** Ligne navigateur : vérifie l'autorisation, obtient un jeton de conversation et enregistre l'appel. */
export async function demarrerAppelNavigateur(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<DemarrageAppel> {
  await exigerOperateur();
  const preparation = await preparerAppel(entrepriseId, prospectId, versionScriptId);
  if (!preparation.ok) return preparation;

  await rafraichirSiAncien();
  const { jeton, conversationId } = await jetonConversation();
  const [appel] = await db
    .insert(appels)
    .values({ entrepriseId, prospectId, versionScriptId, campagneId, ligne: 'navigateur', numero: preparation.numero, conversationId })
    .returning({ id: appels.id });
  if (!appel) return { ok: false, raison: 'Impossible d’enregistrer l’appel.' };
  return { ok: true, appelId: appel.id, jeton, variables: preparation.variables, motsCles: preparation.motsCles };
}

/** Fin de session côté navigateur : le rapatriement et l'analyse continuent après la réponse. */
export async function terminerAppelNavigateur(appelId: string): Promise<void> {
  await exigerOperateur();
  await db.update(appels).set({ finLe: new Date() }).where(eq(appels.id, appelId));
  after(() => traiterAppel(appelId));
}

/**
 * Ligne téléphone (ADR 0007) : vérifie l'autorisation, enregistre l'appel, puis demande au pont de composer.
 * La suite arrive par les routes /api/pont/… (conversation, outils d'agenda, fin).
 */
export async function demarrerAppelTelephone(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<{ ok: true; appelId: string } | { ok: false; raison: string }> {
  await exigerOperateur();
  const preparation = await preparerAppel(entrepriseId, prospectId, versionScriptId);
  if (!preparation.ok) return preparation;

  await rafraichirSiAncien();
  const [appel] = await db
    .insert(appels)
    .values({ entrepriseId, prospectId, versionScriptId, campagneId, ligne: 'bluetooth', numero: preparation.numero })
    .returning({ id: appels.id });
  if (!appel) return { ok: false, raison: 'Impossible d’enregistrer l’appel.' };

  const reponse = await commanderPont('/appels', {
    appelId: appel.id,
    numero: preparation.numero,
    variables: preparation.variables,
    motsCles: preparation.motsCles,
  });
  if (!reponse.ok) {
    await db.update(appels).set({ statut: 'echec', erreur: reponse.raison, finLe: new Date() }).where(eq(appels.id, appel.id));
    return { ok: false, raison: reponse.raison };
  }
  return { ok: true, appelId: appel.id };
}

export async function raccrocherAppelTelephone(appelId: string): Promise<{ ok: true } | { ok: false; raison: string }> {
  await exigerOperateur();
  const reponse = await commanderPont(`/appels/${appelId}/raccrocher`, {});
  return reponse.ok ? { ok: true } : reponse;
}

export async function lancerSimulation(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<{ ok: true; appelId: string } | { ok: false; raison: string }> {
  await exigerOperateur();
  const preparation = await preparerAppel(entrepriseId, prospectId, versionScriptId);
  if (!preparation.ok) return preparation;
  const [appel] = await db
    .insert(appels)
    .values({ entrepriseId, prospectId, versionScriptId, campagneId, ligne: 'simulation', numero: preparation.numero })
    .returning({ id: appels.id });
  if (!appel) return { ok: false, raison: 'Impossible d’enregistrer l’appel.' };
  after(() => simulerAppel(appel.id, preparation.variables));
  return { ok: true, appelId: appel.id };
}

/** Recalcule le bilan (nouvelle version de l'analyseur, ou analyse précédente en échec). */
export async function relancerAnalyse(appelId: string): Promise<void> {
  await exigerOperateur();
  const [appel] = await db.select({ transcription: appels.transcription }).from(appels).where(eq(appels.id, appelId));
  after(() => (appel?.transcription ? analyserAppel(appelId) : traiterAppel(appelId)));
  revalidatePath(`/appels/${appelId}`);
}
