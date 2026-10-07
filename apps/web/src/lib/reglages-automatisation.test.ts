import { describe, expect, it } from 'vitest';
import { avecBaseDeTest } from '../../test/outils';
import { enregistrerReglage, lireReglage } from './reglages-automatisation';

avecBaseDeTest();

describe('réglages des appels', () => {
  it('le jeton renvoyé par l’enregistrement permet une seconde modification après relecture', async () => {
    const defaut = { actif: false };
    const initial = await lireReglage('essai', defaut);
    const premier = await enregistrerReglage('essai', { jours: [2], actif: true, fin: '19:00', debut: '09:00', depuis: null }, initial.empreinte, defaut);
    expect(premier.ok).toBe(true);
    if (!premier.ok) throw new Error(premier.raison);
    expect(premier.empreinte).toBe((await lireReglage('essai', defaut)).empreinte);
    expect(await enregistrerReglage('essai', { actif: false }, premier.empreinte, defaut)).toMatchObject({ ok: true });
  });
  it('conserve les défauts et refuse un second formulaire périmé, même à la première écriture', async () => {
    const defaut = { actif: true };
    const lu = await lireReglage('essai', defaut);
    expect(lu.valeur).toEqual(defaut);
    const resultats = await Promise.all([
      enregistrerReglage('essai', { actif: false }, lu.empreinte, defaut),
      enregistrerReglage('essai', { actif: true, autre: true }, lu.empreinte, defaut),
    ]);
    expect(resultats.filter((r) => r.ok)).toHaveLength(1);
    expect(resultats.find((r) => !r.ok)).toMatchObject({ raison: expect.stringContaining('changé') });
    expect((await lireReglage('essai', defaut)).valeur).not.toEqual(defaut);
  });
});
