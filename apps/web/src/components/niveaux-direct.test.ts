import { describe, expect, it } from 'vitest';
import { lotDeNiveaux, TamponNiveaux } from './niveaux-direct';

const lot = (t: number, mina: number[], prospect: number[]) => ({ t, pasMs: 50, mina, prospect });

describe('lotDeNiveaux', () => {
  it('lit un lot du pont et borne ses valeurs', () => {
    expect(lotDeNiveaux({ type: 'niveaux', t: 1000, pasMs: 50, mina: [0.4, 1.3], prospect: [-1, 0.07] })).toEqual(lot(1000, [0.4, 1], [0, 0.07]));
  });

  it('écarte les autres messages et les lots mal formés', () => {
    expect(lotDeNiveaux({ type: 'tour', role: 'agent', texte: 'Bonjour', t: 1 })).toBeNull();
    expect(lotDeNiveaux({ type: 'niveaux', t: 1000, mina: [0.1], prospect: [] })).toBeNull();
    expect(lotDeNiveaux({ type: 'niveaux', mina: [0.1], prospect: [0.2] })).toBeNull();
    expect(lotDeNiveaux(null)).toBeNull();
  });

  it('garde un pas de 50 ms si le pont n’en donne pas de plausible', () => {
    expect(lotDeNiveaux({ type: 'niveaux', t: 1000, pasMs: 0, mina: [0.1], prospect: [0.2] })?.pasMs).toBe(50);
  });
});

describe('TamponNiveaux', () => {
  it('rejoue les relevés sur l’horloge du navigateur, avec le retard de lecture', () => {
    // Horloge du pont décalée de 10 s : seul compte l'écart entre relevés.
    const tampon = new TamponNiveaux(250);
    tampon.ajouter(lot(10_000_100, [0.2, 0.5], [0, 0.3]), 100);
    // Transit estimé nul : les relevés tombent à 50 et 100 (heure du navigateur), lus 250 ms plus tard.
    const avant = tampon.vue(250 + 99, 4);
    expect(avant.mina).toEqual([0, 0, 0, 0.2]);
    const apres = tampon.vue(250 + 100, 4);
    expect(apres.mina).toEqual([0, 0, 0.2, 0.5]);
    expect(apres.prospect).toEqual([0, 0, 0, 0.3]);
    expect(apres.glisse).toBeCloseTo(0);
    expect(tampon.vue(250 + 125, 4).glisse).toBeCloseTo(0.5);
  });

  it('s’aplatit quand le fil se tait', () => {
    const tampon = new TamponNiveaux(250);
    tampon.ajouter(lot(1000, [0.8], [0.8]), 1000);
    expect(tampon.vue(1250, 3).mina).toEqual([0, 0, 0.8]);
    expect(tampon.vue(1250 + 50 * 5, 3).mina).toEqual([0, 0, 0]);
  });

  it('absorbe un lot en retard : il rejoint ses cases au lieu de décaler la suite', () => {
    const tampon = new TamponNiveaux(250);
    tampon.ajouter(lot(1000, [0.1, 0.2], [0, 0]), 1000);
    tampon.ajouter(lot(1100, [0.3, 0.4], [0, 0]), 1180); // 80 ms de retard réseau
    tampon.ajouter(lot(1200, [0.5, 0.6], [0, 0]), 1200);
    expect(tampon.vue(1200 + 250, 6).mina).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it('un transit qui s’allonge d’un coup : chaque relevé en retard s’affiche dès son arrivée', () => {
    const tampon = new TamponNiveaux(250);
    tampon.ajouter(lot(1000, [0.1], [0]), 1000);
    // Le réseau prend 300 ms de plus : le décalage ne remonte que de 2 ms par lot, les relevés sont déjà dus.
    for (let i = 1; i <= 20; i++) {
      tampon.ajouter(lot(1000 + i * 50, [0.5], [0]), 1300 + i * 50);
      expect(tampon.vue(1300 + i * 50, 8).mina).toContain(0.5);
    }
  });
});
