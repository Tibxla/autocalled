'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { connexionGoogle, rendezVous } from '@/db/schema';
import { creerEvenementDuRendezVous, etatAgenda, synchroniserAgenda } from '@/lib/agenda';
import type { ResultatAction } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';

export async function deconnecterGoogle(): Promise<ResultatAction> {
  await exigerOperateur();
  await db.delete(connexionGoogle);
  revalidatePath('/reglages');
  return { ok: true };
}

/** Relit l'agenda (une vingtaine de secondes par le connecteur) ; un échec garde l'ancienne copie et le dit. */
export async function relireAgenda(): Promise<ResultatAction<{ plagesOccupees: number }>> {
  await exigerOperateur();
  await synchroniserAgenda();
  revalidatePath('/reglages');
  const etat = await etatAgenda();
  if (!etat) return { ok: false, raison: 'L’agenda n’a pas pu être lu : aucune copie enregistrée.' };
  if (etat.erreur) return { ok: false, raison: `La lecture a échoué, l’ancienne copie reste : ${etat.erreur}` };
  return { ok: true, plagesOccupees: etat.occupations.length };
}

/** Nouvelle tentative d'inscription d'un rendez-vous dans l'agenda, attendue jusqu'au bout pour en dire l'issue. */
export async function recreerEvenement(rendezVousId: string): Promise<ResultatAction> {
  await exigerOperateur();
  const [avant] = await db.select({ statut: rendezVous.statut }).from(rendezVous).where(eq(rendezVous.id, rendezVousId));
  if (!avant) return { ok: false, raison: 'Ce rendez-vous n’existe plus.' };
  if (avant.statut === 'cree') return { ok: false, raison: 'L’événement de ce rendez-vous est déjà dans l’agenda.' };
  await creerEvenementDuRendezVous(rendezVousId);
  revalidatePath('/reglages');
  const [apres] = await db.select({ statut: rendezVous.statut, erreur: rendezVous.erreur }).from(rendezVous).where(eq(rendezVous.id, rendezVousId));
  return apres?.statut === 'cree' ? { ok: true } : { ok: false, raison: `L’inscription a encore échoué : ${apres?.erreur ?? 'raison inconnue.'}` };
}
