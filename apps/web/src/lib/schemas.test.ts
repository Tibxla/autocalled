import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { campagneSchema, etapesSchema, ficheSchema, nomScriptSchema, verifierEtapes } from './schemas';

const messages = (r: { success: boolean; error?: z.ZodError }) => r.error?.issues.map((i) => i.message) ?? [];

describe('etapesSchema', () => {
  it('situe l’étape fautive et la formulation', () => {
    const r = etapesSchema.safeParse([
      { intention: 'Accroche courte', exemples: ['Bonjour !'] },
      { intention: 'Ok', exemples: ['a', '', 'b', 'c', 'd'] },
    ]);
    expect(messages(r)).toEqual([
      'Étape 2 : l’intention fait moins de trois caractères.',
      'Étape 2, formulation 2 : formulation vide.',
      'Étape 2 : quatre formulations au plus.',
    ]);
  });

  it('répond en français sur la liste et sur un type faux (serveur MCP)', () => {
    expect(messages(etapesSchema.safeParse([]))).toEqual(['Un script a au moins une étape.']);
    expect(messages(etapesSchema.safeParse('accroche'))).toEqual(['Les étapes sont une liste.']);
    expect(messages(etapesSchema.safeParse([{ intention: 42, exemples: [] }]))).toEqual(['Étape 1 : écris son intention.']);
    expect(messages(etapesSchema.safeParse([{ intention: 'Accroche' }]))).toEqual(['Étape 1 : les formulations sont une liste.']);
  });

  it('garde la position dans un objet englobant (entrée d’outil MCP)', () => {
    const r = z.object({ etapes: etapesSchema }).safeParse({ etapes: [{ intention: 'Accroche', exemples: [] }, { intention: '', exemples: [] }] });
    expect(messages(r)).toEqual(['Étape 2 : l’intention fait moins de trois caractères.']);
  });
});

describe('autres schémas', () => {
  it('n’a plus de message anglais', () => {
    const tous = [
      ...messages(ficheSchema.safeParse({ nom: 'x'.repeat(81), dureeRendezVousMinutes: 'abc', delaiMinimumHeures: 2.5, horizonJours: 0 })),
      ...messages(nomScriptSchema.safeParse('x'.repeat(81))),
      ...messages(campagneSchema.safeParse({ versionScriptId: 'x', ligne: 'fax', prospects: [] })),
    ];
    expect(tous).toContain('Quatre-vingts caractères au plus.');
    expect(tous).toContain('Un nombre est attendu.');
    expect(tous).toContain('Un nombre entier, sans virgule.');
    expect(tous).toContain('Choisis la ligne : navigateur, téléphone ou simulation.');
    for (const m of tous) expect(m).not.toMatch(/Invalid|expected|Too (big|small)/);
  });
});

describe('verifierEtapes (éditeur de version)', () => {
  it('ignore les étapes vides et situe chaque erreur par son rang dans le formulaire', () => {
    const r = verifierEtapes(['Accroche courte', '', 'Ok', 'x'.repeat(301)], ['Bonjour !', '', '', 'a\nb\nc\nd\ne']);
    expect(r).toEqual({
      ok: false,
      erreurs: {
        '2:intention': 'Étape 3 : l’intention fait moins de trois caractères.',
        '3:intention': 'Étape 4 : l’intention dépasse 300 caractères.',
        '3:exemples': 'Étape 4 : quatre formulations au plus.',
      },
    });
  });

  it('dit qu’il faut une étape quand tout est vide', () => {
    expect(verifierEtapes(['', ''], ['', ''])).toEqual({ ok: false, erreurs: { etapes: 'Un script a au moins une étape.' } });
  });

  it('rend les étapes propres quand tout va', () => {
    expect(verifierEtapes(['  Accroche  ', ''], ['Bonjour !\n\n Salut \n', ''])).toEqual({
      ok: true,
      etapes: [{ intention: 'Accroche', exemples: ['Bonjour !', 'Salut'] }],
    });
  });
});
