/** Un créneau tel que Mina le dit : « mardi 29 septembre à 14 h 30 ». */
export function creneauParle(debut: Date, fuseau = 'Europe/Paris'): string {
  const jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuseau }).format(debut);
  const [h, m] = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fuseau })
    .format(debut)
    .split(':');
  const heure = `${Number(h)} h${m === '00' ? '' : ` ${m}`}`;
  return `${jour} à ${heure}`;
}
