'use server';

import type { VariablesDeLAppel } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { appelerParTelephone, enregistrerAppelSimule, preparerAppel, preparerReanalyse, reanalyser, simulerAppel, traiterAppel } from '@/lib/appels';
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

/** Ligne téléphone (ADR 0007) : voir `appelerParTelephone`. */
export async function demarrerAppelTelephone(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<{ ok: true; appelId: string } | { ok: false; raison: string }> {
  await exigerOperateur();
  return appelerParTelephone(entrepriseId, prospectId, versionScriptId, campagneId);
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
  const appel = await enregistrerAppelSimule(entrepriseId, prospectId, versionScriptId, campagneId);
  if (!appel.ok) return appel;
  after(() => simulerAppel(appel.appelId, appel.variables));
  return { ok: true, appelId: appel.appelId };
}

/**
 * Recalcule le bilan (nouvelle version de l'analyseur, ou analyse précédente en échec). L'appel passe en
 * `traitement` avant la réponse : la page revalidée montre l'analyse en cours, puis se relit seule.
 */
export async function demanderAnalyse(appelId: string): Promise<{ ok: true } | { ok: false; raison: string }> {
  await exigerOperateur();
  const preparation = await preparerReanalyse(appelId);
  if (!preparation.ok) return preparation;
  after(() => reanalyser(appelId));
  revalidatePath(`/appels/${appelId}`);
  return { ok: true };
}
