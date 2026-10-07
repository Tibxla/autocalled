'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigerOperateur } from '@/lib/garde';
import { noterAuJournal } from '@/lib/journal';
import { enregistrerReglagesEntrants, lireReglagesEntrants, reglagesEntrantsSchema } from '@/lib/reglages-entrants';

const saisieSchema = z.strictObject({ valeur: reglagesEntrantsSchema, empreinte: z.string().regex(/^[a-f0-9]{64}$/) });

async function preparer(saisie: unknown) {
  const lu = saisieSchema.safeParse(saisie);
  if (!lu.success) return { ok: false as const, raison: lu.error.issues[0]?.message ?? 'Saisie invalide.' };
  const actuel = await lireReglagesEntrants();
  if (actuel.empreinte !== lu.data.empreinte) return { ok: false as const, raison: 'Ces réglages ont changé depuis ta lecture : recharge les valeurs enregistrées.' };
  const nouveau = lu.data.valeur;
  if (nouveau.actif === actuel.valeur.actif && nouveau.accueil === actuel.valeur.accueil) return { ok: false as const, raison: 'Rien ne change.' };
  const lignes = [
    ...(nouveau.actif === actuel.valeur.actif ? [] : [nouveau.actif ? 'L’assistante décrochera les appels des prospects connus et déjà appelés au téléphone.' : 'L’assistante laissera sonner les appels entrants.']),
    ...(nouveau.accueil === actuel.valeur.accueil ? [] : [`Accueil entrant : « ${actuel.valeur.accueil} » → « ${nouveau.accueil} ».`]),
    'Ce changement vaut dès le prochain appel entrant.',
  ];
  return { ok: true as const, lignes, saisie: lu.data };
}

export async function preparerEntrantsAction(saisie: unknown) {
  await exigerOperateur();
  const r = await preparer(saisie);
  if (!r.ok) return r;
  const trace = await noterAuJournal({ origine: 'interface', outil: 'modifier_reglages_entrants', arguments: { actif: r.saisie.valeur.actif, accueilCaracteres: r.saisie.valeur.accueil.length }, resultat: 'confirmation-demandee', message: r.lignes.join('\n'), confirmation: null });
  if (!trace) return { ok: false as const, raison: 'Le journal est indisponible : aucun réglage n’a été changé.' };
  return { ok: true as const, lignes: r.lignes };
}

export async function enregistrerEntrantsAction(saisie: unknown) {
  await exigerOperateur();
  const prepare = await preparer(saisie);
  if (!prepare.ok) return prepare;
  const r = await enregistrerReglagesEntrants(prepare.saisie.valeur, prepare.saisie.empreinte);
  await noterAuJournal({ origine: 'interface', outil: 'modifier_reglages_entrants', arguments: { actif: prepare.saisie.valeur.actif, accueilCaracteres: prepare.saisie.valeur.accueil.length }, resultat: r.ok ? 'ok' : 'refus', message: r.ok ? 'Réglages des appels entrants enregistrés.' : r.raison, confirmation: 'acceptee' });
  if (r.ok) revalidatePath('/reglages');
  return r;
}
