import { describe, expect, it } from 'vitest';
import { lireFiltresAppels } from './filtres';

describe('filtres de la liste des appels lus dans l’URL', () => {
  it('garde ce qui est compris, retire le reste, et ne compte que les appels réels sans ligne choisie', () => {
    const { parametres, filtres } = lireFiltresAppels({
      q: '  plaquette ',
      issue: 'inventee',
      ligne: 'fax',
      version: 'pas-un-uuid',
      periode: '2026-02-31',
      avant: '00000000-0000-4000-8000-000000000001',
      n: '400',
    });
    expect(parametres).toEqual({ q: 'plaquette', avant: '00000000-0000-4000-8000-000000000001' });
    expect(filtres).toEqual({ reels: true, recherche: 'plaquette' });
  });

  it('issue personnalisée, période nommée ou date, version, ligne simulée', () => {
    const perso = 'perso:00000000-0000-4000-8000-000000000002';
    const { filtres } = lireFiltresAppels({ issue: perso, periode: '7-jours', ligne: 'simulation', version: '00000000-0000-4000-8000-000000000003' });
    expect(filtres).toEqual({ reels: true, issue: perso, periode: '7-jours', ligne: 'simulation', version: '00000000-0000-4000-8000-000000000003' });
    expect(lireFiltresAppels({ periode: '2026-09-28' }).filtres.periode).toBe('2026-09-28');
    expect(lireFiltresAppels({ periode: 'tout' }).parametres.periode).toBeUndefined();
    expect(lireFiltresAppels({ issue: 'non-compose' }).filtres.issue).toBe('non-compose');
  });

  it('rappels à faire : « 1 » seulement, et le filtre d’issue s’efface', () => {
    const { parametres, filtres } = lireFiltresAppels({ rappels: '1', issue: 'refus' });
    expect(parametres).toMatchObject({ rappels: '1', issue: undefined });
    expect(filtres).toEqual({ reels: true, rappels: true });
    expect(lireFiltresAppels({ rappels: 'oui' }).filtres).toEqual({ reels: true });
  });
});
