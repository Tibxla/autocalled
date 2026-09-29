import { describe, expect, it } from 'vitest';
import { etapesIdentiques } from './etapes.ts';

const v1 = [
  { intention: 'Accroche : se présenter.', exemples: ['Bonjour, c’est Mina.'] },
  { intention: 'Rendez-vous : proposer un échange.', exemples: [] },
];

describe('etapesIdentiques', () => {
  it('reconnaît les mêmes étapes', () => {
    expect(etapesIdentiques(v1, structuredClone(v1))).toBe(true);
  });

  it('ignore les espaces autour des textes et les exemples vides', () => {
    const recopie = [
      { intention: '  Accroche : se présenter. ', exemples: [' Bonjour, c’est Mina.', ''] },
      { intention: 'Rendez-vous : proposer un échange.', exemples: ['   '] },
    ];

    expect(etapesIdentiques(v1, recopie)).toBe(true);
  });

  it('distingue une intention, un exemple ou un ordre différents', () => {
    expect(etapesIdentiques(v1, [{ ...v1[0]!, intention: 'Accroche : se présenter vite.' }, v1[1]!])).toBe(false);
    expect(etapesIdentiques(v1, [{ ...v1[0]!, exemples: ['Bonjour !'] }, v1[1]!])).toBe(false);
    expect(etapesIdentiques(v1, [v1[1]!, v1[0]!])).toBe(false);
  });

  it('distingue une étape ajoutée ou retirée', () => {
    expect(etapesIdentiques(v1, v1.slice(0, 1))).toBe(false);
    expect(etapesIdentiques(v1, [...v1, { intention: 'Conclure.', exemples: [] }])).toBe(false);
  });
});
