import { describe, expect, it } from 'vitest';
import { appelFini, appelLance, decompteAttendu, ENCHAINEMENT_INITIAL } from './enchainement-campagne';

describe('enchaînement des appels de campagne (ligne navigateur)', () => {
  it('rien ne part sans geste de l’opérateur', () => {
    expect(decompteAttendu(ENCHAINEMENT_INITIAL, 'p1')).toBe(false);
  });

  it('après un appel abouti, le décompte part vers le prospect suivant', () => {
    const e = appelFini(appelLance(ENCHAINEMENT_INITIAL, 'p1'));
    expect(decompteAttendu(e, 'p1')).toBe(false);
    expect(decompteAttendu(e, 'p2')).toBe(true);
  });

  it('une connexion ratée arrête l’enchaînement : ni décompte ni nouvel appel', () => {
    const e = appelFini(appelLance(ENCHAINEMENT_INITIAL, 'p1'), { echec: 'La connexion à Mina a échoué.' });
    expect(e.geste).toBe(false);
    expect(e.echec).toBe('La connexion à Mina a échoué.');
    // La file a avancé (appel clos) : le prospect suivant attend quand même un geste.
    expect(decompteAttendu(e, 'p2')).toBe(false);
  });

  it('un nouveau geste relance l’enchaînement et efface l’échec', () => {
    const e = appelLance(appelFini(appelLance(ENCHAINEMENT_INITIAL, 'p1'), { echec: 'x' }), 'p2');
    expect(e).toEqual({ geste: true, dernier: 'p2', echec: null });
    expect(decompteAttendu(e, 'p3')).toBe(true);
  });
});
