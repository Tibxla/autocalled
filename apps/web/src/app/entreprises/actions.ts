'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { entreprises } from '@/db/schema';
import { type EtatFormulaire, erreursDeZod } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import { slugifier } from '@/lib/slug';

const schema = z.object({
  nom: z.string().trim().min(2, 'Donne un nom d’au moins deux lettres.').max(80, 'Quatre-vingts caractères au plus.'),
});

export async function creerEntreprise(_: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  await exigerOperateur();
  const saisie = schema.safeParse({ nom: donnees.get('nom') });
  if (!saisie.success) return { erreurs: erreursDeZod(saisie.error) };

  const slug = slugifier(saisie.data.nom);
  if (!slug) return { erreurs: { nom: 'Le nom doit contenir au moins une lettre ou un chiffre.' } };

  const [creee] = await db
    .insert(entreprises)
    .values({ nom: saisie.data.nom, slug })
    .onConflictDoNothing({ target: entreprises.slug })
    .returning({ slug: entreprises.slug });
  if (!creee) return { erreurs: { nom: 'Une entreprise porte déjà ce nom.' } };

  redirect(`/entreprises/${creee.slug}`);
}
