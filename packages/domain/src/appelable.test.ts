import { describe, expect, expectTypeOf, it } from 'vitest';
import { type NumeroAppelable, verifierNumero } from './appelable.ts';
import { normaliserNumero } from './numero.ts';

describe('verifierNumero', () => {
  it('rend appelable un numéro valide hors de la liste d’opposition, normalisé', () => {
    const resultat = verifierNumero('06 39 98 00 01', new Set(['+33639980002']));

    expect(resultat.appelable).toBe(true);
    if (resultat.appelable) expect(resultat.numero).toBe('+33639980001');
  });

  it('refuse un numéro de la liste d’opposition, quel que soit son format', () => {
    expect(verifierNumero('06 39 98 00 01', new Set(['+33639980001']))).toEqual({ appelable: false, raison: 'numero-efface' });
  });

  it('refuse tout numéro quand la liste d’opposition ne se lit plus', () => {
    expect(verifierNumero('+33639980001', 'illisible')).toEqual({ appelable: false, raison: 'opposition-illisible' });
  });

  it('refuse un numéro mal formé', () => {
    expect(verifierNumero('12', new Set())).toEqual({ appelable: false, raison: 'numero-invalide' });
  });

  it('ne laisse fabriquer un numéro appelable que par la vérification', () => {
    // Une ligne ne compose qu'un NumeroAppelable : une simple chaîne ne passe pas le typage.
    expectTypeOf<string>().not.toExtend<NumeroAppelable>();
    expectTypeOf(normaliserNumero('+33639980001')).not.toExtend<NumeroAppelable | null>();
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
