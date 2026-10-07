'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { creerEntreprise as creer, supprimerEntrepriseVide } from '@/lib/entreprises';
import { type EtatFormulaire, type ResultatAction, erreursDeZod } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { nomEntrepriseSchema } from '@/lib/schemas';

const schema = z.object({ nom: nomEntrepriseSchema });

export async function supprimerEntreprise(entrepriseId: string, confirmee: boolean): Promise<ResultatAction> {
  await exigerOperateur();
  if (confirmee !== true) return { ok: false, raison: 'Confirme la suppression de l’entreprise.' };
  if (!z.uuid().safeParse(entrepriseId).success) return { ok: false, raison: 'Cette entreprise n’existe plus.' };
  const resultat = await supprimerEntrepriseVide(entrepriseId);
  if (resultat.ok) revalidatePath('/entreprises', 'layout');
  return resultat;
}

export async function creerEntreprise(_: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = schema.safeParse({ nom: donnees.get('nom') });
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const creee = await creer(saisie.data.nom);
  if (!creee.ok) return { erreurs: { nom: creee.raison } };
  redirect(`/entreprises/${creee.slug}`);
}
