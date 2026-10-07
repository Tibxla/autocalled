import 'server-only';
import { z } from 'zod';
import { ACCUEIL_ENTRANT } from './assistante';
import { enregistrerReglage, lireReglage } from './reglages-automatisation';

export const REGLAGES_ENTRANTS_PAR_DEFAUT = { actif: true, accueil: ACCUEIL_ENTRANT };

export const reglagesEntrantsSchema = z.strictObject({
  actif: z.boolean(),
  accueil: z.string().trim().min(1, 'L’accueil ne peut pas être vide.').max(160, 'Cent soixante caractères au plus.')
    .refine((texte) => !/[\r\n]/.test(texte), 'Une seule ligne.')
    .refine((texte) => !/[{}]/.test(texte.replaceAll('{{assistante_nom}}', '')), 'Seule la variable {{assistante_nom}} est permise.'),
});

export type ReglagesEntrants = z.infer<typeof reglagesEntrantsSchema>;

export async function lireReglagesEntrants(): Promise<{ valeur: ReglagesEntrants; empreinte: string }> {
  const lu = await lireReglage('entrants', REGLAGES_ENTRANTS_PAR_DEFAUT);
  // Une configuration illisible laisse sonner ; elle ne réactive jamais silencieusement le décroché.
  return { ...lu, valeur: reglagesEntrantsSchema.parse(lu.valeur) };
}

export async function enregistrerReglagesEntrants(valeur: unknown, empreinteConnue: string) {
  const saisie = reglagesEntrantsSchema.safeParse(valeur);
  if (!saisie.success) return { ok: false as const, raison: saisie.error.issues[0]?.message ?? 'Réglages invalides.' };
  return enregistrerReglage('entrants', saisie.data, empreinteConnue, REGLAGES_ENTRANTS_PAR_DEFAUT);
}
