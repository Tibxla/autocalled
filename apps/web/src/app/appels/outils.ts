'use server';

import { proposerPourAppel, reserverPourAppel } from '@/lib/agenda';
import { exigerOperateur } from '@/lib/garde';

/**
 * Outils d'agenda de Mina, exécutés par le navigateur de l'opérateur pendant l'appel (outils
 * « client » d'ElevenLabs) : rien n'est exposé sur Internet. La réponse est un texte que Mina lit.
 */
export async function outilProposerCreneaux(appelId: string): Promise<string> {
  await exigerOperateur();
  return JSON.stringify(await proposerPourAppel(appelId));
}

export async function outilReserverCreneau(appelId: string, debut: unknown): Promise<string> {
  await exigerOperateur();
  return JSON.stringify(await reserverPourAppel(appelId, debut));
}
