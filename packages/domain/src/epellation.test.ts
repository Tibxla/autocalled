import { describe, expect, it } from 'vitest';
import { epelerAdresse } from './epellation.ts';

describe('epelerAdresse', () => {
  it('épelle la partie avant l’arobase lettre par lettre, et dit un domaine courant en mots', () => {
    expect(epelerAdresse('matheo23@gmail.com')).toBe('M, A, T, H, E, O, 2, 3, arobase gmail point com');
  });

  it('nomme les signes', () => {
    expect(epelerAdresse('jean-marc.du_pont@orange.fr')).toBe(
      'J, E, A, N, tiret, M, A, R, C, point, D, U, tiret bas, P, O, N, T, arobase orange point fr',
    );
  });

  it('épelle aussi un domaine peu courant', () => {
    expect(epelerAdresse('contact@gite-aravis.fr')).toBe('C, O, N, T, A, C, T, arobase G, I, T, E, tiret, A, R, A, V, I, S, point fr');
  });

  it('ignore la casse et les espaces autour', () => {
    expect(epelerAdresse('  Anne@Free.FR ')).toBe('A, N, N, E, arobase free point fr');
  });
});
