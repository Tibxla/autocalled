import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { enregistrerReglage, lireReglage } from './reglages-automatisation';

const heure = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Une heure au format HH:MM est attendue.');
export const reglagesRappelsSchema = z.object({
  actif: z.boolean(),
  jours: z.array(z.number().int().min(1).max(7)).min(1, 'Choisis au moins un jour.').max(7).refine((j) => new Set(j).size === j.length),
  debut: heure,
  fin: heure,
}).strict().refine((v) => v.debut < v.fin, 'L’heure de fin doit suivre l’heure de début.');

export type ReglagesRappels = z.infer<typeof reglagesRappelsSchema> & { depuis: string | null };

export function defautReglagesRappels(): ReglagesRappels {
  const activation = z.iso.datetime({ offset: true }).safeParse(process.env.RAPPELS_AUTOMATIQUES_DEPUIS);
  return { actif: activation.success, depuis: activation.success ? activation.data : null, jours: [1, 2, 3, 4, 5, 6, 7], debut: '09:00', fin: '19:00' };
}

export async function lireReglagesRappels(lecteur: Pick<typeof db, 'select'> = db) {
  const lu = await lireReglage('rappels', defautReglagesRappels(), lecteur);
  const { depuis, ...saisie } = lu.valeur;
  if (!reglagesRappelsSchema.safeParse(saisie).success || !(depuis === null || z.iso.datetime({ offset: true }).safeParse(depuis).success)) {
    throw new Error('Les réglages des rappels ne sont plus valides : aucun rappel automatique ne peut être lancé.');
  }
  return lu;
}

export function dansLesHorairesRappels(maintenant: Date, reglage: ReglagesRappels): boolean {
  if (!reglage.actif || !reglage.depuis) return false;
  const parties = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(maintenant);
  const lire = (type: string) => parties.find((p) => p.type === type)?.value ?? '';
  const jour = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(lire('weekday')) + 1;
  const heureLocale = `${lire('hour')}:${lire('minute')}`;
  return reglage.jours.includes(jour) && heureLocale >= reglage.debut && heureLocale < reglage.fin;
}

export async function enregistrerReglagesRappels(saisie: unknown, empreinteConnue: string, maintenant = new Date()) {
  const valide = reglagesRappelsSchema.safeParse(saisie);
  if (!valide.success) return { ok: false as const, raison: valide.error.issues[0]?.message ?? 'Réglages invalides.' };
  return db.transaction(async (tx) => {
    // Un rappel déjà en préparation finit avant qu'une pause soit enregistrée.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('autocalled:rappels-automatiques'))`);
    const actuelle = await lireReglagesRappels(tx);
    const depuis = actuelle.valeur.depuis ?? (valide.data.actif ? maintenant.toISOString() : null);
    return enregistrerReglage('rappels', { ...valide.data, depuis }, empreinteConnue, defautReglagesRappels(), tx);
  });
}
