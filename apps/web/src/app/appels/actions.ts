'use server';

import type { VariablesDeLAppel } from '@autocalled/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { appels, campagnes, versionsScript } from '@/db/schema';
import { appelerParTelephone, enregistrerAppelSimule, preparerAppel, preparerReanalyse, reanalyser, simulerAppel, traiterAppel } from '@/lib/appels';
import { rafraichirSiAncien } from '@/lib/agenda';
import { jetonConversation } from '@/lib/elevenlabs';
import { exigerOperateur } from '@/lib/garde';
import { commanderPont } from '@/lib/pont';

export type DemarrageAppel =
  | {
      ok: true;
      appelId: string;
      jeton: string;
      variables: VariablesDeLAppel;
      motsCles: string[];
      /** Intentions des étapes de la version, pour nommer l'étape signalée en direct ; facultatif (campagne). */
      etapes?: string[];
    }
  | { ok: false; raison: string };

const uuid = z.uuid();

/** Une campagne désignée par le client doit être une campagne en cours de la même entreprise. */
async function campagneRecevable(entrepriseId: string, campagneId: string | null): Promise<boolean> {
  if (campagneId === null) return true;
  if (!uuid.safeParse(campagneId).success) return false;
  return (await db.$count(campagnes, and(eq(campagnes.id, campagneId), eq(campagnes.entrepriseId, entrepriseId), eq(campagnes.statut, 'en-cours')))) > 0;
}

const CAMPAGNE_INVALIDE = { ok: false as const, raison: 'Cette campagne n’est pas en cours dans cette entreprise.' };

/** Ligne navigateur : vérifie le numéro, obtient un jeton de conversation et enregistre l'appel. */
export async function demarrerAppelNavigateur(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<DemarrageAppel> {
  await exigerOperateur();
  if (!(await campagneRecevable(entrepriseId, campagneId))) return CAMPAGNE_INVALIDE;
  const preparation = await preparerAppel(entrepriseId, prospectId, versionScriptId);
  if (!preparation.ok) return preparation;

  await rafraichirSiAncien();
  // Lu avant l'enregistrement : une erreur ici ne laisse pas d'appel « en cours » derrière elle.
  const [version] = await db.select({ etapes: versionsScript.etapes }).from(versionsScript).where(eq(versionsScript.id, versionScriptId));
  const { jeton, conversationId } = await jetonConversation();
  const [appel] = await db
    .insert(appels)
    .values({
      entrepriseId,
      prospectId,
      versionScriptId,
      campagneId,
      ligne: 'navigateur',
      numero: preparation.numero,
      assistanteNom: preparation.assistanteNom,
      conversationId,
    })
    .returning({ id: appels.id });
  if (!appel) return { ok: false, raison: 'Impossible d’enregistrer l’appel.' };
  return {
    ok: true,
    appelId: appel.id,
    jeton,
    variables: preparation.variables,
    motsCles: preparation.motsCles,
    etapes: (version?.etapes ?? []).map((e) => e.intention),
  };
}

/** Fin de session côté navigateur : le rapatriement et l'analyse continuent après la réponse. */
export async function terminerAppelNavigateur(appelId: string): Promise<void> {
  await exigerOperateur();
  if (!uuid.safeParse(appelId).success) return;
  // Un appel navigateur pas encore clos seulement : ni un appel téléphone, ni une deuxième fin.
  const clos = await db
    .update(appels)
    .set({ finLe: new Date() })
    .where(and(eq(appels.id, appelId), eq(appels.ligne, 'navigateur'), isNull(appels.finLe)))
    .returning({ id: appels.id });
  if (clos.length) after(() => traiterAppel(appelId));
}

/** Ligne téléphone (ADR 0007) : voir `appelerParTelephone`. */
export async function demarrerAppelTelephone(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<{ ok: true; appelId: string } | { ok: false; raison: string }> {
  await exigerOperateur();
  if (!(await campagneRecevable(entrepriseId, campagneId))) return CAMPAGNE_INVALIDE;
  return appelerParTelephone(entrepriseId, prospectId, versionScriptId, campagneId);
}

export async function raccrocherAppelTelephone(appelId: string): Promise<{ ok: true } | { ok: false; raison: string }> {
  await exigerOperateur();
  if (!uuid.safeParse(appelId).success) return { ok: false, raison: 'Appel inconnu.' };
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
  if (!(await campagneRecevable(entrepriseId, campagneId))) return CAMPAGNE_INVALIDE;
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
