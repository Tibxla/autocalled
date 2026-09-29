'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { creerEntreprise as creer } from '@/lib/entreprises';
import { type EtatFormulaire, erreursDeZod } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { nomEntrepriseSchema } from '@/lib/schemas';

const schema = z.object({ nom: nomEntrepriseSchema });

export async function creerEntreprise(_: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = schema.safeParse({ nom: donnees.get('nom') });
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const creee = await creer(saisie.data.nom);
  if (!creee.ok) return { erreurs: { nom: creee.raison } };
  redirect(`/entreprises/${creee.slug}`);
}
