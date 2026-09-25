import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type Consentement,
  type NumeroAutorise,
  verifierAutorisation,
} from './autorisation.js';
import { normaliserNumero } from './numero.js';

const maintenant = new Date('2026-09-25T10:00:00Z');

function consentement(
  numero: string,
  options: { accordeLe?: Date; revoqueLe?: Date | null; texteVersion?: number } = {},
): Consentement {
  const normalise = normaliserNumero(numero);
  if (!normalise) throw new Error(`numéro de test invalide : ${numero}`);
  return {
    numero: normalise,
    texteVersion: options.texteVersion ?? 1,
    source: { type: 'import', importId: 'import-1' },
    accordeLe: options.accordeLe ?? new Date('2026-09-01T00:00:00Z'),
    revoqueLe: options.revoqueLe ?? null,
  };
}

describe('verifierAutorisation', () => {
  it('autorise un numéro qui a un consentement actif', () => {
    const resultat = verifierAutorisation('06 39 98 00 01', [consentement('+33639980001')], maintenant);

    expect(resultat.autorise).toBe(true);
    if (resultat.autorise) expect(resultat.numero).toBe('+33639980001');
  });

  it('refuse un numéro sans aucun consentement', () => {
    const resultat = verifierAutorisation('+33639980001', [consentement('+33639980002')], maintenant);

    expect(resultat).toEqual({ autorise: false, raison: 'aucun-consentement' });
  });

  it('refuse un numéro dont le consentement a été révoqué', () => {
    const revoque = consentement('+33639980001', { revoqueLe: new Date('2026-09-20T00:00:00Z') });

    const resultat = verifierAutorisation('+33639980001', [revoque], maintenant);

    expect(resultat).toEqual({ autorise: false, raison: 'consentement-revoque' });
  });

  it('autorise encore un numéro dont la révocation est programmée plus tard', () => {
    const revoqueDemain = consentement('+33639980001', { revoqueLe: new Date('2026-09-26T00:00:00Z') });

    expect(verifierAutorisation('+33639980001', [revoqueDemain], maintenant).autorise).toBe(true);
  });

  it("refuse un consentement qui n'est pas encore accordé", () => {
    const futur = consentement('+33639980001', { accordeLe: new Date('2026-10-01T00:00:00Z') });

    expect(verifierAutorisation('+33639980001', [futur], maintenant)).toEqual({
      autorise: false,
      raison: 'aucun-consentement',
    });
  });

  it('autorise si un nouveau consentement suit une révocation', () => {
    const ancien = consentement('+33639980001', { revoqueLe: new Date('2026-09-10T00:00:00Z') });
    const nouveau = consentement('+33639980001', {
      accordeLe: new Date('2026-09-15T00:00:00Z'),
      texteVersion: 2,
    });

    const resultat = verifierAutorisation('+33639980001', [ancien, nouveau], maintenant);

    expect(resultat.autorise).toBe(true);
    if (resultat.autorise) expect(resultat.consentement.texteVersion).toBe(2);
  });

  it('refuse un numéro mal formé', () => {
    expect(verifierAutorisation('12', [], maintenant)).toEqual({
      autorise: false,
      raison: 'numero-invalide',
    });
  });

  it('ne laisse fabriquer un numéro autorisé que par la vérification', () => {
    // Une ligne ne compose qu'un NumeroAutorise : une simple chaîne ne passe pas le typage.
    expectTypeOf<string>().not.toExtend<NumeroAutorise>();
    expectTypeOf(normaliserNumero('+33639980001')).not.toExtend<NumeroAutorise | null>();
  });
});

describe('normaliserNumero', () => {
  it.each([
    ['06 39 98 00 01', '+33639980001'],
    ['0639980001', '+33639980001'],
    ['+33 6 39 98 00 01', '+33639980001'],
    ['+1 415 555 2671', '+14155552671'],
  ])('normalise %s en %s', (brut, attendu) => {
    expect(normaliserNumero(brut)).toBe(attendu);
  });

  it.each(['', '12', 'pas un numéro', '06 12'])('rejette %j', (brut) => {
    expect(normaliserNumero(brut)).toBeNull();
  });
});
