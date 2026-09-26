import { describe, expect, it } from 'vitest';
import { chiffrer, dechiffrer } from './chiffrement.ts';
import { creneauParle } from './libelles.ts';
import { PORTEES, urlConsentement } from './google.ts';

const CLE = 'a'.repeat(64);

describe('chiffrement', () => {
  it('rend le texte d’origine, et un paquet différent à chaque fois', () => {
    const a = chiffrer('jeton-secret', CLE);
    expect(a).not.toBe(chiffrer('jeton-secret', CLE));
    expect(dechiffrer(a, CLE)).toBe('jeton-secret');
  });

  it('refuse un paquet altéré ou une mauvaise clé', () => {
    const paquet = chiffrer('jeton-secret', CLE);
    expect(() => dechiffrer(paquet, 'b'.repeat(64))).toThrow();
    expect(() => dechiffrer(`${paquet.slice(0, -2)}xx`, CLE)).toThrow();
  });
});

describe('creneauParle', () => {
  it('dit l’heure comme au téléphone', () => {
    expect(creneauParle(new Date('2026-09-29T12:00:00Z'))).toBe('mardi 29 septembre à 14 h');
    expect(creneauParle(new Date('2026-10-27T13:30:00Z'))).toBe('mardi 27 octobre à 14 h 30');
  });
});

describe('urlConsentement', () => {
  it('demande un accès hors ligne avec les seules portées nécessaires', () => {
    const url = new URL(urlConsentement({ clientId: 'id', clientSecret: 's', redirectUri: 'https://x/retour' }, 'etat'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(PORTEES);
    expect(PORTEES.join(' ')).not.toMatch(/auth\/calendar(\s|$)/);
  });
});
