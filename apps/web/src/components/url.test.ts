import { describe, expect, it } from 'vitest';
import { lienAvec } from './url';

describe('lienAvec', () => {
  it('pose, remplace et retire des paramètres dans un ordre stable', () => {
    expect(lienAvec('/appels', { q: 'martin', issue: 'refus' }, { issue: 'rendez-vous-pris' })).toBe('/appels?q=martin&issue=rendez-vous-pris');
    expect(lienAvec('/appels', { q: 'martin', issue: 'refus' }, { issue: null })).toBe('/appels?q=martin');
    expect(lienAvec('/appels', { q: undefined }, { page: '2' })).toBe('/appels?page=2');
  });

  it('rend le chemin nu quand il ne reste rien', () => {
    expect(lienAvec('/appels', { q: 'martin' }, { q: null })).toBe('/appels');
    expect(lienAvec('/appels', {}, { q: '' })).toBe('/appels');
  });

  it('encode les valeurs', () => {
    expect(lienAvec('/appels', {}, { q: 'Gîte des Tilleuls' })).toBe('/appels?q=G%C3%AEte+des+Tilleuls');
  });
});
