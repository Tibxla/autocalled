import { describe, expect, it } from 'vitest';
import type { AppelDuJour } from '@/lib/accueil';
import { bilanJournee, cleFiltre, comptesFiltres, correspond, filtrerAppels, lireFiltres } from './filtres';

// Données fictives.
function appel(p: Partial<AppelDuJour> = {}): AppelDuJour {
  return {
    id: 'a1',
    debutLe: '2026-09-29T08:00:00Z',
    finLe: null,
    dureeSecondes: null,
    ligne: 'bluetooth',
    statut: 'termine',
    issue: 'refus',
    issueSysteme: 'refus',
    erreur: null,
    conversation: true,
    campagneId: null,
    resume: 'Satisfaite de son système de réservation.',
    etapeAtteinte: 1,
    rappel: null,
    nombreEtapes: 4,
    prospectId: 'p',
    prospect: 'Julie Martin',
    societe: 'Gîte des Tilleuls',
    entreprise: 'Atelier Vitrine',
    entrepriseSlug: 'atelier-vitrine',
    libellePerso: null,
    rendezVous: null,
    ...p,
  };
}

const JOUR = [
  appel({ id: '1' }),
  appel({ id: '2', issue: 'non-abouti', issueSysteme: 'non-abouti', conversation: false }),
  appel({ id: '3', issue: 'perso:9', issueSysteme: 'rendez-vous-pris', libellePerso: 'Visio fixée' }),
  appel({ id: '4', statut: 'traitement', issue: null, issueSysteme: null }),
  appel({ id: '5', statut: 'echec', issue: null, issueSysteme: null }),
  appel({ id: '6', ligne: 'simulation' }),
  appel({ id: '7', statut: 'echec', issue: null, issueSysteme: null, conversation: false }),
];

describe('cleFiltre et comptes', () => {
  it('issue système, clé système des issues personnalisées, non composé, sans bilan', () => {
    expect(JOUR.map(cleFiltre)).toEqual(['refus', 'non-abouti', 'rendez-vous-pris', 'sans-bilan', 'sans-bilan', 'refus', 'non-compose']);
  });

  it('les simulés à part ; la somme des cases fait Tous', () => {
    const c = comptesFiltres(JOUR);
    expect(c.tous).toBe(6);
    expect(c.simules).toBe(1);
    expect(Object.values(c.parCle).reduce((s, n) => s + n, 0)).toBe(c.tous);
    expect(c.parCle.refus).toBe(1);
    expect(c.parCle['sans-bilan']).toBe(2);
    expect(c.parCle['non-compose']).toBe(1);
    expect(c.parCle.interrompu).toBe(0);
  });
});

describe('lireFiltres', () => {
  it('ignore une issue inconnue ; Simulés est exclusif', () => {
    expect(lireFiltres({ issue: 'refus' })).toEqual({ issue: 'refus', simules: false });
    expect(lireFiltres({ issue: 'nimporte' })).toEqual({ issue: null, simules: false });
    expect(lireFiltres({ issue: 'refus', simules: '1' })).toEqual({ issue: null, simules: true });
  });
});

describe('filtrerAppels', () => {
  it('par issue, parmi les appels réels', () => {
    expect(filtrerAppels(JOUR, { issue: 'refus', simules: false, texte: '', trouves: null }).map((a) => a.id)).toEqual(['1']);
  });

  it('Simulés : seulement les simulés', () => {
    expect(filtrerAppels(JOUR, { issue: null, simules: true, texte: '', trouves: null }).map((a) => a.id)).toEqual(['6']);
  });

  it('recherche locale sans accents ni casse, recherche serveur quand elle est appliquée', () => {
    expect(correspond(appel(), 'gite')).toBe(true);
    expect(correspond(appel(), 'RESERVATION')).toBe(true);
    expect(correspond(appel(), 'livraison')).toBe(false);
    expect(filtrerAppels(JOUR, { issue: null, simules: false, texte: 'livraison', trouves: new Set(['4']) }).map((a) => a.id)).toEqual(['4']);
  });
});

describe('bilanJournee', () => {
  it('conversations = issue autre que non abouti ; rendez-vous ; simulés à part', () => {
    expect(bilanJournee(JOUR)).toEqual({ total: 6, conversations: 2, rendezVous: 1, simules: 1, premier: '2026-09-29T08:00:00Z' });
  });
});
