import { DateTime } from 'luxon';

/** Un créneau commence toujours sur une heure ou une demi-heure : « 14 h 30 » se dit bien au téléphone. */
export const PAS_MINUTES = 30;

export interface Intervalle {
  debut: Date;
  fin: Date;
}

export interface PlageHoraire {
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  jour: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Heure locale « HH:mm » dans le fuseau des règles. */
  debut: string;
  fin: string;
}

export interface ReglesRendezVous {
  dureeMinutes: number;
  plages: PlageHoraire[];
  delaiMinimumHeures: number;
  horizonJours: number;
  fuseau: string;
}

function aHeure(jour: DateTime, heure: string): DateTime {
  const [h, m] = heure.split(':').map(Number);
  return jour.set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 });
}

function chevauche(a: Intervalle, b: Intervalle): boolean {
  return a.debut < b.fin && b.debut < a.fin;
}

/** Tous les créneaux libres, dans l'ordre chronologique. */
export function creneauxLibres(
  regles: ReglesRendezVous,
  occupations: readonly Intervalle[],
  maintenant: Date,
): Intervalle[] {
  const auPlusTot = DateTime.fromJSDate(maintenant).plus({ hours: regles.delaiMinimumHeures });
  const limite = DateTime.fromJSDate(maintenant).plus({ days: regles.horizonJours });
  const libres: Intervalle[] = [];

  let jour = DateTime.fromJSDate(maintenant, { zone: regles.fuseau }).startOf('day');
  while (jour < limite) {
    const plagesDuJour = regles.plages
      .filter((p) => p.jour === jour.weekday)
      .sort((a, b) => a.debut.localeCompare(b.debut));

    for (const plage of plagesDuJour) {
      const finPlage = aHeure(jour, plage.fin);
      // Construit depuis l'heure locale : 14 h reste 14 h de part et d'autre d'un changement d'heure.
      for (let debut = aHeure(jour, plage.debut); ; debut = debut.plus({ minutes: PAS_MINUTES })) {
        const fin = debut.plus({ minutes: regles.dureeMinutes });
        if (fin > finPlage) break;
        if (debut < auPlusTot || debut >= limite) continue;
        const creneau = { debut: debut.toJSDate(), fin: fin.toJSDate() };
        if (!occupations.some((o) => chevauche(creneau, o))) libres.push(creneau);
      }
    }
    jour = jour.plus({ days: 1 });
  }
  return libres;
}

/**
 * Choisit quelques créneaux à proposer au téléphone : d'abord le premier de chaque jour, pour
 * offrir un vrai choix, puis, s'il manque des jours, les suivants dans l'ordre.
 */
export function proposerCreneaux(
  regles: ReglesRendezVous,
  occupations: readonly Intervalle[],
  maintenant: Date,
  nombre = 3,
): Intervalle[] {
  const libres = creneauxLibres(regles, occupations, maintenant);
  const jourDe = (c: Intervalle) => DateTime.fromJSDate(c.debut, { zone: regles.fuseau }).toISODate();

  const choisis: Intervalle[] = [];
  const joursPris = new Set<string | null>();
  for (const creneau of libres) {
    if (choisis.length === nombre) break;
    if (joursPris.has(jourDe(creneau))) continue;
    joursPris.add(jourDe(creneau));
    choisis.push(creneau);
  }
  for (const creneau of libres) {
    if (choisis.length === nombre) break;
    if (!choisis.includes(creneau)) choisis.push(creneau);
  }
  return choisis.sort((a, b) => a.debut.getTime() - b.debut.getTime());
}

/** Revérifie un créneau au moment de réserver : il a pu être pris depuis qu'il a été proposé. */
export function estReservable(
  creneau: Intervalle,
  regles: ReglesRendezVous,
  occupations: readonly Intervalle[],
  maintenant: Date,
): boolean {
  return creneauxLibres(regles, occupations, maintenant).some(
    (c) => c.debut.getTime() === creneau.debut.getTime() && c.fin.getTime() === creneau.fin.getTime(),
  );
}
