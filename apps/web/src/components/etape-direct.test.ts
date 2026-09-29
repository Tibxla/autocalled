import { describe, expect, it } from 'vitest';
import { ETAPE_MAX, etapeAffichee, libelleEtape, numeroEtape } from './etape-direct';

describe('numeroEtape', () => {
  it('lit un entier de 1 à 10, en nombre ou en texte', () => {
    expect(numeroEtape(2)).toBe(2);
    expect(numeroEtape('3')).toBe(3);
    expect(numeroEtape(' 4 ')).toBe(4);
    expect(numeroEtape(ETAPE_MAX)).toBe(ETAPE_MAX);
  });

  it('refuse le reste', () => {
    for (const v of [0, -1, ETAPE_MAX + 1, 2.5, '2.0', 'deux', '', null, undefined, true, [2], { numero: 2 }, Number.NaN]) {
      expect(numeroEtape(v)).toBeNull();
    }
  });
});

describe('libelleEtape', () => {
  it("garde l'intention avant le premier deux-points", () => {
    expect(libelleEtape('Qualification : comment arrivent ses réservations aujourd’hui')).toBe('Qualification');
    expect(libelleEtape('  Accroche   courte ')).toBe('Accroche courte');
  });

  it('coupe une intention longue sur un mot, à 40 caractères au plus', () => {
    const l = libelleEtape('Proposer un échange de trente minutes pour lui montrer ce que ça donnerait');
    expect(l).toBe('Proposer un échange de trente minutes…');
    expect(l.length).toBeLessThanOrEqual(41);
  });

  it('un deux-points en tête ne vide pas le libellé', () => {
    expect(libelleEtape(': rien avant')).toBe(': rien avant');
  });
});

describe('etapeAffichee', () => {
  const etapes = ['Accroche : une phrase', 'Qualification', 'Pitch', 'Rendez-vous'];

  it('numéro, total et libellé', () => {
    expect(etapeAffichee(2, etapes)).toEqual({ numero: 2, total: 4, libelle: 'Qualification' });
    expect(etapeAffichee(1, etapes)).toEqual({ numero: 1, total: 4, libelle: 'Accroche' });
  });

  it('sans les étapes de la version : le numéro seul', () => {
    expect(etapeAffichee(2)).toEqual({ numero: 2, total: null, libelle: null });
    expect(etapeAffichee(2, [])).toEqual({ numero: 2, total: null, libelle: null });
  });

  it('rien sans étape signalée ou au-delà du plan', () => {
    expect(etapeAffichee(null, etapes)).toBeNull();
    expect(etapeAffichee(undefined, etapes)).toBeNull();
    expect(etapeAffichee(5, etapes)).toBeNull();
    expect(etapeAffichee(0, etapes)).toBeNull();
  });
});
