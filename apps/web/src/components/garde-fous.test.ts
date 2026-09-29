import { describe, expect, it } from 'vitest';
import { desserre, dureeLisible, estimation, validerReglages, type ReglagesLigne } from './garde-fous';

const reglages: ReglagesLigne = { appelsParHeure: 15, appelsParJour: 50, pauseEntreAppelsS: 5 };

describe('validerReglages', () => {
  it('accepte des réglages dans les bornes', () => {
    expect(validerReglages(reglages)).toEqual({});
  });

  it('refuse hors bornes et non entier', () => {
    expect(validerReglages({ ...reglages, appelsParHeure: 61 })).toEqual({ appelsParHeure: 'Entre 1 et 60.' });
    expect(validerReglages({ ...reglages, pauseEntreAppelsS: 4 })).toEqual({ pauseEntreAppelsS: 'Entre 5 et 600.' });
    expect(validerReglages({ ...reglages, appelsParJour: 12.5 })).toEqual({ appelsParJour: 'Un nombre entier.' });
  });

  it('refuse un plafond par jour sous le plafond par heure', () => {
    expect(validerReglages({ ...reglages, appelsParHeure: 20, appelsParJour: 10 })).toEqual({
      appelsParJour: 'Le plafond par jour ne peut pas être inférieur au plafond par heure.',
    });
  });
});

describe('desserre', () => {
  it('repère une hausse de plafond ou une pause raccourcie', () => {
    expect(desserre(reglages, { ...reglages, appelsParHeure: 16 })).toBe(true);
    expect(desserre(reglages, { ...reglages, appelsParJour: 60 })).toBe(true);
    expect(desserre({ ...reglages, pauseEntreAppelsS: 30 }, reglages)).toBe(true);
  });

  it('laisse passer un resserrement ou rien', () => {
    expect(desserre(reglages, reglages)).toBe(false);
    expect(desserre(reglages, { ...reglages, appelsParHeure: 10, pauseEntreAppelsS: 30 })).toBe(false);
  });
});

describe('estimation', () => {
  it('100 appels à 15 par heure, pause 5 s : six heures pleines, plus les pauses de la dernière heure', () => {
    const r = estimation({ appels: 100, reglages: { ...reglages, appelsParJour: 500 } });
    // Le 100e appel part une heure après le 85e, … six heures après le 10e, lui-même 9 pauses de 5 s après le 1er.
    expect(r.minutesAuPlusTot).toBeCloseTo(360.75);
    expect(r.phrase).toBe('À ce rythme, le dernier des 100 appels partira au plus tôt dans 6 h 01.');
    expect(r.arretApres).toBeNull();
  });

  it('la pause l’emporte quand elle est longue', () => {
    const r = estimation({ appels: 11, reglages: { appelsParHeure: 60, appelsParJour: 500, pauseEntreAppelsS: 600 } });
    expect(r.minutesAuPlusTot).toBe(100);
    expect(r.phrase).toBe('À ce rythme, le dernier des 11 appels partira au plus tôt dans 1 h 40.');
  });

  it('prévient quand le plafond du jour arrête la ligne', () => {
    const r = estimation({ appels: 100, reglages, passes24h: 12 });
    expect(r.arretApres).toBe(38);
    expect(r.phrase).toContain('Le plafond par jour arrêtera la ligne après 38 appels, d’après la base.');
  });

  it('traite zéro et un appel', () => {
    expect(estimation({ appels: 0, reglages }).phrase).toBe('Aucun appel à passer.');
    expect(estimation({ appels: 1, reglages }).minutesAuPlusTot).toBe(0);
  });
});

describe('dureeLisible', () => {
  it('écrit minutes et heures', () => {
    expect(dureeLisible(0.5)).toBe('moins d’une minute');
    expect(dureeLisible(12)).toBe('12 min');
    expect(dureeLisible(80)).toBe('1 h 20');
    expect(dureeLisible(360)).toBe('6 h');
  });
});
