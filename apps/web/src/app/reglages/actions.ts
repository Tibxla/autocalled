'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { db } from '@/db';
import { connexionGoogle } from '@/db/schema';
import { creerEvenementDuRendezVous, synchroniserAgenda } from '@/lib/agenda';
import { exigerOperateur } from '@/lib/garde';

export async function deconnecterGoogle(): Promise<void> {
  await exigerOperateur();
  await db.delete(connexionGoogle);
  revalidatePath('/reglages');
}

export async function relireAgenda(): Promise<void> {
  await exigerOperateur();
  await synchroniserAgenda();
  revalidatePath('/reglages');
}

export async function recreerEvenement(rendezVousId: string): Promise<void> {
  await exigerOperateur();
  after(() => creerEvenementDuRendezVous(rendezVousId));
  revalidatePath('/reglages');
}
