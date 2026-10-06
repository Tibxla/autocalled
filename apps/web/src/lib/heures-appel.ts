/** La ligne appelle entre 9 h et 19 h, heure de Paris, tous les jours. */
export const HEURES_D_APPEL = { debut: 9, fin: 19 } as const;

export function dansLesHeuresDAppel(maintenant: Date): boolean {
  const parties = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).formatToParts(maintenant);
  const heure = Number(parties.find((p) => p.type === 'hour')?.value);
  return heure >= HEURES_D_APPEL.debut && heure < HEURES_D_APPEL.fin;
}
