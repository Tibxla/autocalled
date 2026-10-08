'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  type Attendu,
  detailVersion,
  enregistrerIdentite,
  enregistrerEtAppliquerPrompt,
  enregistrerEtAppliquerReglages,
  preparerIdentite,
  preparerPoussee,
  pousserEtCommiter,
  rapatrierEtCommiter,
  restaurerEtAppliquer,
  type Resultat,
} from '@/lib/edition-assistante';
import { exigerOperateur } from '@/lib/garde';
import { patchReglagesSchema } from '@/lib/reglages-assistante';

/**
 * Les gestes de la page Assistante, par les mêmes fonctions que le serveur MCP (mcp/assistante.ts) : chaque action
 * exige l'opérateur, lit son entrée avec le même schéma que l'outil, puis passe par lib/edition-assistante.ts, qui
 * appelle les mêmes fonctions que le MCP. Rien ici ne décide seul : la confirmation se fait dans la page, sur le texte
 * rédigé par le serveur.
 */

const identiteSchema = z
  .strictObject({
    nom: z.string().max(200).optional(),
    premierMessage: z.string().max(2000).optional(),
    connu: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine((s) => s.nom !== undefined || s.premierMessage !== undefined, 'Donne un nom ou un premier message.');
const empreinteSchema = z.string().min(1).max(200);
const promptSchema = z.string().min(500).max(20_000);
const versionSchema = z.string().min(1).max(100);
const attenduSchema = z.strictObject({ empreinteLocale: z.string().min(1).max(200), versionIdDistante: z.string().max(100).nullable() });

const SAISIE_ILLISIBLE = { ok: false as const, raison: 'Saisie illisible : recharge la page.' };

function lire<T>(schema: z.ZodType<T>, valeur: unknown): { ok: true; data: T } | { ok: false; raison: string } {
  const r = schema.safeParse(valeur);
  if (r.success) return { ok: true, data: r.data };
  const probleme = r.error.issues[0];
  return probleme?.code === 'custom' ? { ok: false, raison: probleme.message } : SAISIE_ILLISIBLE;
}

const sansConnu = (e: z.infer<typeof identiteSchema>) => ({
  ...(e.nom !== undefined ? { nom: e.nom } : {}),
  ...(e.premierMessage !== undefined ? { premierMessage: e.premierMessage } : {}),
});

/** La question de la confirmation du nom et du premier message (ancien → nouveau, campagne en cours). */
export async function preparerIdentiteAction(saisie: unknown): Promise<Resultat<{ lignes: string[] }>> {
  await exigerOperateur();
  const e = lire(identiteSchema, saisie);
  if (!e.ok) return e;
  return preparerIdentite(sansConnu(e.data), e.data.connu);
}

export async function enregistrerIdentiteAction(saisie: unknown): Promise<Resultat<{ modifieLe: string; rappel: string }>> {
  await exigerOperateur();
  const e = lire(identiteSchema, saisie);
  if (!e.ok) return e;
  const r = await enregistrerIdentite(sansConnu(e.data), e.data.connu);
  if (r.ok) revalidatePath('/assistante');
  return r;
}

export async function enregistrerPromptAction(
  texte: unknown,
  empreinteConnue: unknown,
): Promise<Awaited<ReturnType<typeof enregistrerEtAppliquerPrompt>>> {
  await exigerOperateur();
  const prompt = lire(promptSchema, texte);
  if (!prompt.ok) return prompt;
  const empreinte = lire(empreinteSchema, empreinteConnue);
  if (!empreinte.ok) return empreinte;
  const r = await enregistrerEtAppliquerPrompt(prompt.data, empreinte.data);
  if (r.ok) revalidatePath('/assistante');
  return r;
}

export async function enregistrerReglagesAction(
  reglages: unknown,
  empreinteConnue: unknown,
): Promise<Awaited<ReturnType<typeof enregistrerEtAppliquerReglages>>> {
  await exigerOperateur();
  const empreinte = lire(empreinteSchema, empreinteConnue);
  if (!empreinte.ok) return empreinte;
  // Les bornes : le même schéma que modifier_reglages_assistante, avec le message du champ fautif.
  const patch = patchReglagesSchema.safeParse(reglages);
  if (!patch.success) {
    const probleme = patch.error.issues[0];
    return { ok: false, raison: `Réglage refusé (${probleme?.path.join('.') || 'saisie'}) : ${probleme?.message ?? 'valeur invalide'}` };
  }
  // Enregistré, poussé, puis commité dans la foulée (ADR 0010, amendement du 08/10).
  const r = await enregistrerEtAppliquerReglages(patch.data, empreinte.data);
  if (r.ok) revalidatePath('/assistante');
  return r;
}

/** Lit ElevenLabs et rédige la différence d'une poussée ; n'écrit rien. */
export async function preparerPousseeAction(): Promise<Resultat<{ question: string; difference: string; campagneEnCours: boolean; attendu: Attendu }>> {
  await exigerOperateur();
  return preparerPoussee();
}

export async function pousserAction(attendu: unknown): Promise<Awaited<ReturnType<typeof pousserEtCommiter>>> {
  await exigerOperateur();
  const a = lire(attenduSchema, attendu);
  if (!a.ok) return a;
  const r = await pousserEtCommiter(a.data);
  revalidatePath('/assistante');
  return r;
}

export async function rapatrierAction(): Promise<Awaited<ReturnType<typeof rapatrierEtCommiter>>> {
  await exigerOperateur();
  const r = await rapatrierEtCommiter();
  if (r.ok) revalidatePath('/assistante');
  return r;
}

/** La différence entre une version consignée et `agent/`, pour la confirmation d'une restauration ; n'écrit rien. */
export async function detailVersionAction(versionId: unknown): Promise<Resultat<{ versionId: string; difference: string; appels: number; identique: boolean }>> {
  await exigerOperateur();
  const v = lire(versionSchema, versionId);
  if (!v.ok) return v;
  return detailVersion(v.data);
}

export async function restaurerAction(versionId: unknown): Promise<Awaited<ReturnType<typeof restaurerEtAppliquer>>> {
  await exigerOperateur();
  const v = lire(versionSchema, versionId);
  if (!v.ok) return v;
  const r = await restaurerEtAppliquer(v.data);
  if (r.ok) revalidatePath('/assistante');
  return r;
}
