'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigerOperateur } from '@/lib/garde';
import { noterAuJournal } from '@/lib/journal';
import { enregistrerReglagesRappels, lireReglagesRappels, reglagesRappelsSchema } from '@/lib/reglages-rappels';

const saisieSchema = z.strictObject({ valeur: reglagesRappelsSchema, empreinte: z.string().regex(/^[a-f0-9]{64}$/) });

async function preparer(saisie: unknown) {
  const valide = saisieSchema.safeParse(saisie);
  if (!valide.success) return { ok: false as const, raison: valide.error.issues[0]?.message ?? 'Réglages invalides.' };
  const actuel = await lireReglagesRappels();
  if (actuel.empreinte !== valide.data.empreinte) return { ok: false as const, raison: 'Ces réglages ont changé depuis ta lecture. Recharge-les avant d’enregistrer.' };
  const v = valide.data.valeur;
  const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  return {
    ok: true as const, saisie: valide.data,
    lignes: [
      v.actif ? `Les rappels convenus seront composés automatiquement les ${v.jours.map((j) => jours[j - 1]).join(', ')}, de ${v.debut} à ${v.fin}, heure de Paris.` : 'Les rappels convenus resteront à faire ; aucun rappel automatique ne sera composé.',
      actuel.valeur.depuis ? 'Les rappels éligibles déjà en attente suivront ces réglages au prochain réveil, toutes les cinq minutes.' : 'Les échéances antérieures à cette première activation resteront manuelles.',
      'Les plafonds, les oppositions et la disponibilité de la ligne restent vérifiés avant chaque appel.',
    ],
  };
}

export async function preparerRappelsAction(saisie: unknown) {
  await exigerOperateur();
  const r = await preparer(saisie);
  if (!r.ok) return r;
  const note = await noterAuJournal({ origine: 'interface', outil: 'modifier_reglages_rappels', arguments: r.saisie.valeur, resultat: 'confirmation-demandee', message: r.lignes.join('\n'), confirmation: null });
  return note ? { ok: true as const, lignes: r.lignes } : { ok: false as const, raison: 'Le journal est indisponible : aucun réglage n’a changé.' };
}

export async function enregistrerRappelsAction(saisie: unknown) {
  await exigerOperateur();
  const p = await preparer(saisie);
  if (!p.ok) return p;
  const r = await enregistrerReglagesRappels(p.saisie.valeur, p.saisie.empreinte);
  await noterAuJournal({ origine: 'interface', outil: 'modifier_reglages_rappels', arguments: p.saisie.valeur, resultat: r.ok ? 'ok' : 'refus', message: r.ok ? 'Réglages des rappels enregistrés.' : r.raison, confirmation: 'acceptee' });
  if (r.ok) {
    revalidatePath('/reglages');
    revalidatePath('/');
    revalidatePath('/entreprises', 'layout');
  }
  return r;
}
