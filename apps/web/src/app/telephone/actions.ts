'use server';

import { revalidatePath } from 'next/cache';
import { exigerOperateur } from '@/lib/garde';
import { commanderPont } from '@/lib/pont';

export type Appairage = { etat: 'ferme' | 'ouvert' | 'reussi' | 'expire'; adresse: string | null; code: string | null; restantS?: number };
type Resultat<T> = { ok: true; valeur: T } | { ok: false; raison: string };

async function appairage(chemin: string, corps?: unknown): Promise<Resultat<Appairage>> {
  await exigerOperateur();
  const r = await commanderPont(chemin, corps);
  return r.ok ? { ok: true, valeur: r.corps as unknown as Appairage } : r;
}

/** Ouvre la fenêtre d'appairage (trois minutes), filtrée sur l'adresse Bluetooth du téléphone. */
export async function ouvrirAppairage(adresse: string) {
  return appairage('/appairage', { adresse });
}

export async function lireAppairage() {
  return appairage('/appairage');
}

export async function fermerAppairage() {
  return appairage('/appairage/fermer', {});
}

/** Retire le téléphone des appareils connus du serveur (avant de passer à un autre téléphone). */
export async function oublierTelephone(adresse: string): Promise<{ ok: true } | { ok: false; raison: string }> {
  await exigerOperateur();
  const r = await commanderPont('/telephone/oublier', { adresse });
  revalidatePath('/telephone');
  return r.ok ? { ok: true } : r;
}
