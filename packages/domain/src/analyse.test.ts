import { describe, expect, it } from 'vitest';
import { type AppelAnalyse, SEUIL_ECHANTILLON, statistiquesObjections, statistiquesParVersion } from './analyse.ts';

function appel(partiel: Partial<AppelAnalyse>): AppelAnalyse {
  return { versionScriptId: 'v1', issueSysteme: 'refus', etapeAtteinte: 2, objections: [], ...partiel };
}

describe('statistiquesParVersion', () => {
  it('exclut les appels non aboutis du taux de rendez-vous', () => {
    const [v1] = statistiquesParVersion([
      appel({ issueSysteme: 'rendez-vous-pris', etapeAtteinte: 4 }),
      appel({ issueSysteme: 'refus' }),
      appel({ issueSysteme: 'non-abouti', etapeAtteinte: 0 }),
    ]);

    expect(v1).toMatchObject({ versionScriptId: 'v1', appels: 3, conversations: 2, rendezVous: 1, tauxRendezVous: 0.5 });
  });

  it('signale un échantillon insuffisant sous le seuil', () => {
    const [v1] = statistiquesParVersion([appel({})]);

    expect(v1?.echantillonSuffisant).toBe(false);
    expect(SEUIL_ECHANTILLON).toBe(10);
  });

  it('juge un échantillon suffisant à partir de dix conversations', () => {
    const [v1] = statistiquesParVersion(Array.from({ length: 10 }, () => appel({})));

    expect(v1?.echantillonSuffisant).toBe(true);
  });

  it('donne l’étape médiane où les appels sans rendez-vous s’arrêtent', () => {
    const [v1] = statistiquesParVersion([
      appel({ etapeAtteinte: 1 }),
      appel({ etapeAtteinte: 2 }),
      appel({ etapeAtteinte: 3 }),
      appel({ issueSysteme: 'rendez-vous-pris', etapeAtteinte: 4 }),
    ]);

    expect(v1?.etapeMedianeSansRendezVous).toBe(2);
  });

  it('sépare les versions et garde un taux nul quand aucune conversation n’a eu lieu', () => {
    const stats = statistiquesParVersion([appel({ versionScriptId: 'v2', issueSysteme: 'non-abouti' }), appel({})]);

    expect(stats.map((s) => s.versionScriptId).sort()).toEqual(['v1', 'v2']);
    expect(stats.find((s) => s.versionScriptId === 'v2')).toMatchObject({ conversations: 0, tauxRendezVous: null });
  });
});

describe('statistiquesObjections', () => {
  it('compte les apparitions, les levées et le temps CRAC qui bloque le plus', () => {
    const stats = statistiquesObjections([
      appel({ objections: [{ objectionId: 'booking', levee: true, tempsBloquant: null }] }),
      appel({ objections: [{ objectionId: 'booking', levee: false, tempsBloquant: 'argumenter' }] }),
      appel({ objections: [{ objectionId: 'booking', levee: false, tempsBloquant: 'argumenter' }] }),
      appel({ objections: [{ objectionId: null, levee: false, tempsBloquant: 'creuser' }] }),
    ]);

    expect(stats).toEqual([
      { objectionId: 'booking', apparitions: 3, levees: 1, tempsBloquantPrincipal: 'argumenter' },
      { objectionId: null, apparitions: 1, levees: 0, tempsBloquantPrincipal: 'creuser' },
    ]);
  });
});
