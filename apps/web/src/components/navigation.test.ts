import { describe, expect, it } from 'vitest';
import { estCourante, NAVIGATION_PRINCIPALE, sansEntreesLarges } from './navigation';

describe('navigation principale', () => {
  it('garde cinq entrées là où Assistante ne tient pas, Réglages s’allumant pour elle', () => {
    const etroite = sansEntreesLarges(NAVIGATION_PRINCIPALE);
    expect(etroite.map((e) => e.libelle)).toEqual(['Accueil', 'Entreprises', 'Appels', 'Téléphone', 'Réglages']);
    const reglages = etroite.find((e) => e.href === '/reglages')!;
    expect(estCourante('/assistante', reglages)).toBe(true);
    expect(estCourante('/reglages', reglages)).toBe(true);
  });

  it('dès 1024 px, Assistante s’allume seule sur sa page', () => {
    const assistante = NAVIGATION_PRINCIPALE.find((e) => e.href === '/assistante')!;
    const reglages = NAVIGATION_PRINCIPALE.find((e) => e.href === '/reglages')!;
    expect(assistante.large).toBe(true);
    expect(estCourante('/assistante', assistante)).toBe(true);
    expect(estCourante('/assistante', reglages)).toBe(false);
  });
});
