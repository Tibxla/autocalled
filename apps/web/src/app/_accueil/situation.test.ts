import { describe, expect, it } from 'vitest';
import type { AppelDuJour, CampagneJour, EtatLigneServeur } from '@/lib/accueil';
import { ANALYSE_BLOQUEE_MS, campagneTelephoneEnCours, FENETRE_FIN_MS, ligneBloquee, raisonSuspension, situationAccueil } from './situation';

// Données fictives.
const MAINTENANT = Date.parse('2026-09-29T12:00:00Z');
const il = (ms: number) => new Date(MAINTENANT - ms).toISOString();

function appel(p: Partial<AppelDuJour> = {}): AppelDuJour {
  return {
    id: 'a1',
    debutLe: il(20 * 60_000),
    finLe: il(17 * 60_000),
    dureeSecondes: 180,
    ligne: 'bluetooth',
    statut: 'termine',
    issue: 'refus',
    issueSysteme: 'refus',
    erreur: null,
    conversation: true,
    campagneId: null,
    resume: 'Pas intéressée.',
    etapeAtteinte: 2,
    rappel: null,
    nombreEtapes: 4,
    prospectId: 'julie-martin',
    prospect: 'Julie Martin',
    societe: 'Gîte des Tilleuls',
    entreprise: 'Atelier Vitrine',
    entrepriseSlug: 'atelier-vitrine',
    libellePerso: null,
    rendezVous: null,
    ...p,
  };
}

function campagne(p: Partial<CampagneJour> = {}): CampagneJour {
  return {
    id: 'c1',
    entreprise: 'Atelier Vitrine',
    entrepriseSlug: 'atelier-vitrine',
    version: 'Script principal v3',
    ligne: 'bluetooth',
    statut: 'prete',
    creeLe: il(60 * 60_000),
    comptes: { total: 100, aAppeler: 66, enAppel: 0, appelees: 30, sautees: 4, retirees: 0, traites: 34 },
    prochain: { nom: 'Marc Dupont', societe: 'Boulangerie Dupont' },
    dernierAppel: null,
    ...p,
  };
}

const LIBRE: EtatLigneServeur = {
  joignable: true,
  connecte: true,
  appelEnCours: false,
  appelId: null,
  plafond: null,
  reglages: { appelsParHeure: 15, appelsParJour: 50, pauseEntreAppelsS: 5 },
};

const base = { appelVivant: null, appels: [] as AppelDuJour[], campagnes: [] as CampagneJour[], premiereUtilisation: false, maintenant: MAINTENANT };

describe('situationAccueil : priorités', () => {
  it('un appel vivant passe avant tout, identité comprise quand elle correspond', () => {
    const vivant = { id: 'x', prospect: 'Julie Martin', societe: null, entreprise: 'Atelier Vitrine', version: null, numeroMasque: '06 •• •• •• 01', debutLe: il(0), conversation: true, campagneId: null, etapes: ['Accroche'] };
    const s = situationAccueil({
      ...base,
      ligne: { ...LIBRE, appelEnCours: true, appelId: 'x', plafond: 'Plafond atteint.' },
      appelVivant: vivant,
      campagnes: [campagne({ statut: 'en-cours' })],
    });
    expect(s).toEqual({ type: 'appel', appelId: 'x', appel: vivant });
  });

  it("l'appel vivant sans identité connue reste un appel", () => {
    const s = situationAccueil({ ...base, ligne: { ...LIBRE, appelEnCours: true, appelId: 'y' } });
    expect(s).toEqual({ type: 'appel', appelId: 'y', appel: null });
  });

  it('seul le pont dit qu’un appel vit : un statut en-cours en base ne suffit pas', () => {
    const s = situationAccueil({ ...base, ligne: LIBRE, appels: [appel({ statut: 'en-cours', finLe: null, debutLe: il(60_000) })] });
    expect(s.type).toBe('libre');
  });

  it('ligne injoignable, puis téléphone déconnecté, avant le plafond', () => {
    const c = campagne({ statut: 'en-pause' });
    expect(situationAccueil({ ...base, ligne: { joignable: false }, campagnes: [c] })).toEqual({ type: 'ligne-coupee', raison: 'injoignable', campagne: c, entrepriseSlug: 'atelier-vitrine' });
    expect(situationAccueil({ ...base, ligne: { ...LIBRE, connecte: false, plafond: 'x' } })).toEqual({
      type: 'ligne-coupee',
      raison: 'deconnecte',
      campagne: null,
      entrepriseSlug: null,
    });
  });

  it('la ligne coupée ne rappelle que les campagnes téléphone ouvertes', () => {
    const s = situationAccueil({ ...base, ligne: { joignable: false }, campagnes: [campagne({ ligne: 'simulation', statut: 'en-pause' })] });
    expect(s).toEqual({ type: 'ligne-coupee', raison: 'injoignable', campagne: null, entrepriseSlug: 'atelier-vitrine' });
  });

  it('ligne déconnectée et campagne navigateur en cours : la campagne passe avant', () => {
    const c = campagne({ ligne: 'navigateur', statut: 'en-cours' });
    const s = situationAccueil({ ...base, ligne: { ...LIBRE, connecte: false }, campagnes: [c] });
    expect(s).toEqual({ type: 'campagne-entre-deux', campagne: c });
  });

  it('ligne injoignable et campagne simulée en cours : la campagne passe avant', () => {
    const c = campagne({ ligne: 'simulation', statut: 'en-cours' });
    expect(situationAccueil({ ...base, ligne: { joignable: false }, campagnes: [c] })).toEqual({ type: 'campagne-entre-deux', campagne: c });
  });

  it('ligne déconnectée et campagne téléphone en cours : la ligne coupée passe avant', () => {
    const c = campagne({ ligne: 'bluetooth', statut: 'en-cours' });
    const s = situationAccueil({ ...base, ligne: { ...LIBRE, connecte: false }, campagnes: [c] });
    expect(s).toEqual({ type: 'ligne-coupee', raison: 'deconnecte', campagne: c, entrepriseSlug: 'atelier-vitrine' });
  });

  it('ligne déconnectée et appel navigateur fini il y a 2 min : fin d’appel', () => {
    const a = appel({ ligne: 'navigateur', finLe: il(2 * 60_000) });
    const s = situationAccueil({ ...base, ligne: { ...LIBRE, connecte: false }, appels: [a] });
    expect(s).toEqual({ type: 'fin-appel', appel: a, bloquee: false });
  });

  it('fin d’appel avant le plafond', () => {
    const a = appel({ finLe: il(60_000) });
    const s = situationAccueil({ ...base, ligne: { ...LIBRE, plafond: 'Plafond de 15 appels par heure atteint.' }, appels: [a] });
    expect(s).toEqual({ type: 'fin-appel', appel: a, bloquee: false });
  });

  it('plafond avant une campagne téléphone en cours', () => {
    const c = campagne({ statut: 'en-cours' });
    const s = situationAccueil({ ...base, ligne: { ...LIBRE, plafond: 'Plafond de 15 appels par heure atteint.' }, campagnes: [c] });
    expect(s).toEqual({ type: 'plafond', phrase: 'Plafond de 15 appels par heure atteint.', campagne: c });
  });

  it('fin d’appel dans la fenêtre de 15 min, avant une campagne en cours', () => {
    const a = appel({ statut: 'traitement', finLe: il(60_000) });
    const s = situationAccueil({ ...base, ligne: LIBRE, appels: [a], campagnes: [campagne({ statut: 'en-cours' })] });
    expect(s).toEqual({ type: 'fin-appel', appel: a, bloquee: false });
  });

  it('au-delà de 15 min, la fin d’appel cède la place', () => {
    const a = appel({ finLe: new Date(MAINTENANT - FENETRE_FIN_MS - 1000).toISOString() });
    const s = situationAccueil({ ...base, ligne: LIBRE, appels: [a] });
    expect(s.type).toBe('libre');
  });

  it('une analyse sans nouvelle depuis plus de 5 min est dite bloquée', () => {
    const a = appel({ statut: 'traitement', finLe: new Date(MAINTENANT - ANALYSE_BLOQUEE_MS - 1000).toISOString() });
    expect(situationAccueil({ ...base, ligne: LIBRE, appels: [a] })).toEqual({ type: 'fin-appel', appel: a, bloquee: true });
  });

  it('un échec récent est une fin d’appel', () => {
    const a = appel({ statut: 'echec', conversation: false, erreur: 'Numéro injoignable.', finLe: il(30_000) });
    expect(situationAccueil({ ...base, ligne: LIBRE, appels: [a] }).type).toBe('fin-appel');
  });

  it('pas de fin d’appel quand l’appel le plus récent est encore ouvert', () => {
    const ouvert = appel({ id: 'a2', statut: 'en-cours', ligne: 'navigateur', debutLe: il(10_000), finLe: null });
    const fini = appel({ finLe: il(60_000) });
    expect(situationAccueil({ ...base, ligne: LIBRE, appels: [ouvert, fini] }).type).toBe('libre');
  });

  it('campagne en cours, puis suspendue, puis prête', () => {
    const enCours = campagne({ id: 'e', statut: 'en-cours' });
    const suspendue = campagne({ id: 's', statut: 'en-pause' });
    const prete = campagne({ id: 'p', statut: 'prete' });
    expect(situationAccueil({ ...base, ligne: LIBRE, campagnes: [prete, suspendue, enCours] })).toEqual({ type: 'campagne-entre-deux', campagne: enCours });
    expect(situationAccueil({ ...base, ligne: LIBRE, campagnes: [prete, suspendue] })).toEqual({
      type: 'campagne-suspendue',
      campagne: suspendue,
      raison: null,
    });
    expect(situationAccueil({ ...base, ligne: LIBRE, campagnes: [prete] })).toEqual({ type: 'campagne-prete', campagne: prete });
  });

  it('ligne libre : dernier appel, première utilisation, entreprise à préparer', () => {
    const a = appel({ finLe: il(FENETRE_FIN_MS * 2) });
    expect(situationAccueil({ ...base, ligne: LIBRE, appels: [a] })).toEqual({
      type: 'libre',
      dernier: a,
      premiereUtilisation: false,
      entrepriseSlug: 'atelier-vitrine',
    });
    expect(situationAccueil({ ...base, ligne: LIBRE, premiereUtilisation: true })).toEqual({
      type: 'libre',
      dernier: null,
      premiereUtilisation: true,
      entrepriseSlug: null,
    });
  });
});

describe('raisonSuspension', () => {
  it('ligne coupée ou plafond, pour une campagne téléphone', () => {
    const c = campagne({ statut: 'en-pause' });
    expect(raisonSuspension(c, { joignable: false })?.texte).toMatch(/injoignable/);
    expect(raisonSuspension(c, { ...LIBRE, connecte: false })?.texte).toMatch(/déconnecté/);
    expect(raisonSuspension(c, { ...LIBRE, plafond: 'Plafond de 50 appels par jour atteint.' })?.texte).toBe('Plafond de 50 appels par jour atteint.');
  });

  it('dernier appel pas parti : son erreur', () => {
    const c = campagne({
      statut: 'en-pause',
      dernierAppel: { id: 'd', statut: 'echec', erreur: 'Le téléphone ne répond pas.', finLe: il(0), conversation: false, prospect: 'Marc Dupont' },
    });
    expect(raisonSuspension(c, LIBRE)).toEqual({ texte: 'L’appel de Marc Dupont n’est pas parti : Le téléphone ne répond pas.', ton: 'alerte' });
  });

  it('suspendue à la main : aucune raison inventée', () => {
    const c = campagne({
      statut: 'en-pause',
      dernierAppel: { id: 'd', statut: 'termine', erreur: null, finLe: il(0), conversation: true, prospect: 'Marc Dupont' },
    });
    expect(raisonSuspension(c, LIBRE)).toBeNull();
  });

  it('une campagne simulée ignore l’état de la ligne téléphone', () => {
    expect(raisonSuspension(campagne({ ligne: 'simulation', statut: 'en-pause' }), { joignable: false })).toBeNull();
  });
});

describe('ligneBloquee', () => {
  it('dit pourquoi aucun appel téléphone ne peut partir', () => {
    expect(ligneBloquee(LIBRE)).toBeNull();
    expect(ligneBloquee({ joignable: false })).toMatch(/injoignable/);
    expect(ligneBloquee({ ...LIBRE, plafond: 'x' })).toMatch(/plafond/);
  });
});

describe('campagneTelephoneEnCours', () => {
  it('rend la campagne téléphone en cours, jamais une suspendue ni une autre ligne', () => {
    const tel = campagne({ id: 't', ligne: 'bluetooth', statut: 'en-cours' });
    expect(campagneTelephoneEnCours([campagne({ ligne: 'navigateur', statut: 'en-cours' }), tel])).toBe(tel);
    expect(campagneTelephoneEnCours([campagne({ ligne: 'bluetooth', statut: 'en-pause' })])).toBeNull();
    expect(campagneTelephoneEnCours([])).toBeNull();
  });
});
