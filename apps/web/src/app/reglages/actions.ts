'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { connexionGoogle } from '@/db/schema';
import { exigerOperateur } from '@/lib/garde';

export async function deconnecterGoogle(): Promise<void> {
  await exigerOperateur();
  await db.delete(connexionGoogle);
  revalidatePath('/reglages');
}
