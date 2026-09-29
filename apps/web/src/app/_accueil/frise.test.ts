import { describe, expect, it } from 'vitest';
import type { AppelDuJour } from '@/lib/accueil';
import { bornesFrise, graduations, minutesParis, position, resumeFrise, traitFrise } from './frise';

// Données fictives.
function appel(p: Partial<AppelDuJour> = {}): AppelDuJour {
  return {
    id: 'a1',
    debutLe: '2026-09-29T08:00:00Z', // 10:00 à Paris (heure d'été)
    finLe: '2026-09-29T08:03:00Z',
    dureeSecondes: 180,
    ligne: 'bluetooth',
    statut: 'termine',
    issue: 'refus',
    issueSysteme: 'refus',
    erreur: null,
    conversation: true,
    campagneId: null,
    resume: null,
    etapeAtteinte: 2,
    rappel: null,
    nombreEtapes: 4,
    prospectId: 'p',
    prospect: 'Julie Martin',
    societe: null,
    entreprise: 'Atelier Vitrine',
    entrepriseSlug: 'atelier-vitrine',
    libellePerso: null,
    rendezVous: null,
    ...p,
  };
}

describe('minutesParis', () => {
  it('lit l’horloge de Paris, en été comme en hiver', () => {
    expect(minutesParis('2026-09-29T08:00:00Z')).toBe(600);
    expect(minutesParis('2026-12-01T08:00:00Z')).toBe(540);
  });

  it('minuit de Paris : 23:30 UTC la veille est 01:30 le jour même', () => {
    expect(minutesParis('2026-09-28T23:30:00Z')).toBe(90);
  });

  it('changement d’heure du 25 octobre 2026 : l’heure affichée fait foi', () => {
    // 00:30 UTC = 02:30 heure d'été ; 01:30 UTC = 02:30 heure d'hiver (l'heure est rejouée).
    expect(minutesParis('2026-10-25T00:30:00Z')).toBe(150);
    expect(minutesParis('2026-10-25T01:30:00Z')).toBe(150);
    expect(minutesParis('2026-10-25T10:00:00Z')).toBe(660);
  });
});

describe('bornesFrise', () => {
  it('de 9 h à 19 h par défaut', () => {
    expect(bornesFrise([], null)).toEqual({ debut: 540, fin: 1140 });
    expect(bornesFrise([appel()], 700)).toEqual({ debut: 540, fin: 1140 });
  });

  it('élargies à l’heure pleine du premier appel et à celle qui suit le dernier', () => {
    const tot = appel({ debutLe: '2026-09-29T05:40:00Z', finLe: null, dureeSecondes: 60 }); // 07:40
    const tard = appel({ debutLe: '2026-09-29T18:10:00Z', dureeSecondes: 600 }); // 20:10 → 20:20
    expect(bornesFrise([tot, tard], null)).toEqual({ debut: 420, fin: 1260 });
  });

  it('élargies à maintenant, jamais au-delà de minuit', () => {
    expect(bornesFrise([], 19 * 60 + 5)).toEqual({ debut: 540, fin: 1200 });
    expect(bornesFrise([], 23 * 60 + 59)).toEqual({ debut: 540, fin: 1440 });
  });

  it('un appel juste après minuit de Paris ouvre la frise à 0 h', () => {
    expect(bornesFrise([appel({ debutLe: '2026-09-28T22:20:00Z' })], null).debut).toBe(0);
  });
});

describe('graduations et positions', () => {
  it('une heure pleine par graduation, une sur deux secondaire', () => {
    const g = graduations({ debut: 540, fin: 1140 });
    expect(g).toHaveLength(10);
    expect(g[0]).toEqual({ minutes: 540, libelle: '09:00', position: 0, secondaire: false });
    expect(g[1]?.secondaire).toBe(true);
    expect(g[9]?.libelle).toBe('18:00');
    expect(g[5]?.position).toBe(50);
  });

  it('position bornée à la frise', () => {
    expect(position(300, { debut: 540, fin: 1140 })).toBe(0);
    expect(position(1200, { debut: 540, fin: 1140 })).toBe(100);
  });
});

describe('traitFrise', () => {
  const b = { debut: 540, fin: 1140 };

  it('position, largeur de la durée, hauteur de l’étape atteinte', () => {
    const t = traitFrise(appel(), b);
    expect(t.gauche).toBe(10);
    expect(t.largeur).toBeCloseTo(0.5);
    expect(t.hauteur).toBe(25); // 4 + 42 × 2 / 4
    expect(t.forme).toBe('normal');
  });

  it('rendez-vous en encre, à la hauteur de son étape', () => {
    const t = traitFrise(appel({ issue: 'rendez-vous-pris', issueSysteme: 'rendez-vous-pris', etapeAtteinte: 4 }), b);
    expect(t).toMatchObject({ forme: 'rendez-vous', hauteur: 46 });
  });

  it('non abouti sans issue système (route de fin) : trait plein minimal', () => {
    const t = traitFrise(appel({ issue: 'non-abouti', issueSysteme: 'non-abouti', etapeAtteinte: null, nombreEtapes: 4 }), b);
    expect(t).toMatchObject({ forme: 'normal', hauteur: 4 });
  });

  it('analyse et sans bilan : pointillé au minimum ; échec en brique', () => {
    expect(traitFrise(appel({ statut: 'traitement' }), b)).toMatchObject({ forme: 'pointille', hauteur: 4 });
    expect(traitFrise(appel({ statut: 'termine', issue: null, issueSysteme: null }), b)).toMatchObject({ forme: 'pointille', hauteur: 4 });
    expect(traitFrise(appel({ statut: 'echec' }), b).forme).toBe('echec');
  });

  it('appel vivant : antenne, pleine hauteur', () => {
    expect(traitFrise(appel({ statut: 'en-cours' }), b, { vivant: true })).toMatchObject({ forme: 'vivant', hauteur: 48 });
  });
});

describe('resumeFrise', () => {
  it('compte les appels, leurs heures et les rendez-vous', () => {
    const a = [
      appel({ id: '1', debutLe: '2026-09-29T07:02:00Z' }),
      appel({ id: '2', debutLe: '2026-09-29T12:31:00Z', issue: 'rendez-vous-pris', issueSysteme: 'rendez-vous-pris' }),
    ];
    expect(resumeFrise(a, null)).toBe('2 appels de 09:02 à 14:31, dont 1 rendez-vous.');
    expect(resumeFrise(a, { debutLe: '2026-09-29T12:35:00Z' })).toBe('2 appels de 09:02 à 14:31, dont 1 rendez-vous ; appel en cours depuis 14:35.');
  });

  it('journée vide', () => {
    expect(resumeFrise([], null)).toBe('Aucun appel aujourd’hui.');
  });
});
