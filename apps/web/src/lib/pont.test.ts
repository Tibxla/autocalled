import { afterEach, describe, expect, it, vi } from 'vitest';
import { commanderPont, disponibiliteLigne, refusDuPont } from './pont';

afterEach(() => vi.restoreAllMocks());

describe('assistante indisponible', () => {
  it('prioritaire sur la ligne occupée et le plafond ; un appel manuel est aussi refusé', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      appelEnCours: true, plafond: 'Plafond fictif', assistanteIndisponible: { raison: 'quota_exceeded', quota: true },
    }));
    expect(await disponibiliteLigne()).toEqual({ type: 'assistante-indisponible', raison: 'quota_exceeded' });
    expect(await refusDuPont({ ligneLibre: true })).toBe('quota_exceeded');
  });

  it.each([
    [503, 'absente'], [429, 'absente'],
  ])('/etat HTTP %i conserve le comportement téléphone absent', async (statut, type) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ erreur: 'Refus fictif' }, { status: statut }));
    expect(await disponibiliteLigne()).toEqual({ type, raison: 'Refus fictif' });
  });

  it('le refus de dépendance 424 reste distinct des refus 503 et 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ erreur: 'quota_exceeded' }, { status: 424 }));
    expect(await commanderPont('/appels', {})).toEqual({ ok: false, statut: 424, raison: 'quota_exceeded' });
  });

  it('un plafond signalé dans /etat reste un plafond', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ plafond: 'Plafond fictif' }));
    expect(await disponibiliteLigne()).toEqual({ type: 'plafond', raison: 'Plafond fictif' });
  });
});
