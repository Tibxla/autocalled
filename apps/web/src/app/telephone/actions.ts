'use server';

import { revalidatePath } from 'next/cache';
import { exigerOperateur } from '@/lib/garde';
import { commanderPont, type ReglagesLigne } from '@/lib/pont';

export type EtatTelephone = {
  connecte: boolean;
  nom?: string;
  adresse?: string;
  operateur?: string;
  signal?: number;
  batterie?: number;
  appelEnCours: boolean;
  /** L'appel que le pont porte en ce moment ; absent ou nul quand la ligne est libre. */
  appelId?: string | null;
  plafond: string | null;
  reglages: ReglagesLigne;
};

export type Appairage = { etat: 'ferme' | 'ouvert' | 'reussi' | 'expire'; adresse: string | null; code: string | null; restantS?: number };
type Resultat<T> = { ok: true; valeur: T } | { ok: false; raison: string };

async function appairage(chemin: string, corps?: unknown): Promise<Resultat<Appairage>> {
  await exigerOperateur();
  const r = await commanderPont(chemin, corps);
  return r.ok ? { ok: true, valeur: r.corps as unknown as Appairage } : r;
}

/**
 * Ouvre la fenêtre d'appairage (trois minutes), filtrée sur l'adresse Bluetooth du téléphone. Pour changer
 * de téléphone, `remplacer` est l'adresse de l'ancien : le pont l'oublie dès que le nouveau est appairé.
 */
export async function ouvrirAppairage(adresse: string, remplacer: string | null = null) {
  return appairage('/appairage', { adresse, remplacer });
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

/** Garde-fous de la ligne : plafonds d'appels et pause entre deux appels de campagne, validés par le pont. */
export async function enregistrerReglages(
  _: { message: string | null; ok: boolean },
  donnees: FormData,
): Promise<{ message: string | null; ok: boolean }> {
  await exigerOperateur();
  const r = await commanderPont('/reglages', {
    appelsParHeure: donnees.get('appelsParHeure'),
    appelsParJour: donnees.get('appelsParJour'),
    pauseEntreAppelsS: donnees.get('pauseEntreAppelsS'),
  });
  revalidatePath('/telephone');
  return r.ok ? { message: 'Réglages enregistrés.', ok: true } : { message: r.raison, ok: false };
}

/** Relance la liaison Bluetooth du téléphone passerelle, à distance (liaison figée, téléphone revenu à portée). */
export async function reconnecterTelephone(): Promise<{ ok: true } | { ok: false; raison: string }> {
  await exigerOperateur();
  const r = await commanderPont('/telephone/reconnecter', {});
  return r.ok ? { ok: true } : r;
}
