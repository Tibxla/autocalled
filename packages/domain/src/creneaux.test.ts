import { describe, expect, it } from 'vitest';
import { type Intervalle, type ReglesRendezVous, estReservable, proposerCreneaux } from './creneaux.js';

/** Vendredi 25 septembre 2026, 18 h à Paris. */
const maintenant = new Date('2026-09-25T16:00:00Z');

const regles: ReglesRendezVous = {
  dureeMinutes: 30,
  plages: [
    { jour: 2, debut: '14:00', fin: '18:00' },
    { jour: 4, debut: '14:00', fin: '18:00' },
  ],
  delaiMinimumHeures: 24,
  horizonJours: 14,
  fuseau: 'Europe/Paris',
};

const debuts = (creneaux: Intervalle[]) => creneaux.map((c) => c.debut.toISOString());

function occupe(debut: string, fin: string): Intervalle {
  return { debut: new Date(debut), fin: new Date(fin) };
}

describe('proposerCreneaux', () => {
  it('propose trois créneaux sur trois jours différents, dans l’ordre', () => {
    const creneaux = proposerCreneaux(regles, [], maintenant);

    expect(debuts(creneaux)).toEqual([
      '2026-09-29T12:00:00.000Z', // mardi 29, 14 h
      '2026-10-01T12:00:00.000Z', // jeudi 1er, 14 h
      '2026-10-06T12:00:00.000Z', // mardi 6, 14 h
    ]);
    expect(creneaux[0]?.fin.toISOString()).toBe('2026-09-29T12:30:00.000Z');
  });

  it('respecte le délai minimum', () => {
    // Lundi 28, 15 h : le mardi 29 à 14 h est à moins de 24 h.
    const lundi = new Date('2026-09-28T13:00:00Z');

    expect(debuts(proposerCreneaux(regles, [], lundi))[0]).toBe('2026-09-29T13:00:00.000Z');
  });

  it("ne propose rien au-delà de l'horizon", () => {
    const creneaux = proposerCreneaux({ ...regles, horizonJours: 5 }, [], maintenant);

    expect(debuts(creneaux)).toEqual(['2026-09-29T12:00:00.000Z', '2026-09-29T12:30:00.000Z', '2026-09-29T13:00:00.000Z']);
  });

  it('évite les occupations et accepte un créneau qui les touche', () => {
    const cours = occupe('2026-09-29T11:00:00Z', '2026-09-29T13:00:00Z'); // mardi 13 h – 15 h

    expect(debuts(proposerCreneaux(regles, [cours], maintenant))[0]).toBe('2026-09-29T13:00:00.000Z');
  });

  it('écarte un jour entièrement occupé', () => {
    const journee = occupe('2026-09-29T00:00:00Z', '2026-09-30T00:00:00Z');

    expect(debuts(proposerCreneaux(regles, [journee], maintenant))[0]).toBe('2026-10-01T12:00:00.000Z');
  });

  it('ne dépasse jamais la fin de la plage', () => {
    const regles1h: ReglesRendezVous = {
      ...regles,
      dureeMinutes: 60,
      plages: [{ jour: 2, debut: '14:00', fin: '15:30' }],
      horizonJours: 5,
    };

    expect(debuts(proposerCreneaux(regles1h, [], maintenant))).toEqual([
      '2026-09-29T12:00:00.000Z',
      '2026-09-29T12:30:00.000Z',
    ]);
  });

  it("garde l'heure locale au passage à l'heure d'hiver", () => {
    // Le 25 octobre 2026, Paris passe de UTC+2 à UTC+1 : 14 h devient 13:00Z.
    const avant = new Date('2026-10-18T16:00:00Z');

    expect(debuts(proposerCreneaux(regles, [], avant))).toEqual([
      '2026-10-20T12:00:00.000Z', // mardi 20, heure d'été
      '2026-10-22T12:00:00.000Z', // jeudi 22, heure d'été
      '2026-10-27T13:00:00.000Z', // mardi 27, heure d'hiver
    ]);
  });

  it('renvoie une liste vide quand rien n’est libre', () => {
    const toutOccupe = occupe('2026-09-25T00:00:00Z', '2026-10-31T00:00:00Z');

    expect(proposerCreneaux(regles, [toutOccupe], maintenant)).toEqual([]);
  });
});

describe('estReservable', () => {
  const mardi14h = occupe('2026-09-29T12:00:00Z', '2026-09-29T12:30:00Z');

  it('accepte un créneau libre qui respecte les règles', () => {
    expect(estReservable(mardi14h, regles, [], maintenant)).toBe(true);
  });

  it('refuse un créneau pris entre la proposition et la réservation', () => {
    const rendezVousPris = occupe('2026-09-29T12:15:00Z', '2026-09-29T12:45:00Z');

    expect(estReservable(mardi14h, regles, [rendezVousPris], maintenant)).toBe(false);
  });

  it('refuse un créneau hors plage, mal aligné ou de mauvaise durée', () => {
    expect(estReservable(occupe('2026-09-30T12:00:00Z', '2026-09-30T12:30:00Z'), regles, [], maintenant)).toBe(false);
    expect(estReservable(occupe('2026-09-29T12:10:00Z', '2026-09-29T12:40:00Z'), regles, [], maintenant)).toBe(false);
    expect(estReservable(occupe('2026-09-29T12:00:00Z', '2026-09-29T13:00:00Z'), regles, [], maintenant)).toBe(false);
  });

  it('refuse un créneau devenu trop proche', () => {
    const mardiMidi = new Date('2026-09-29T10:00:00Z');

    expect(estReservable(mardi14h, regles, [], mardiMidi)).toBe(false);
  });
});
