import type { EntreeCampagne } from '@autocalled/domain';
import { describe, expect, it } from 'vitest';
import {
  chrono,
  cleJour,
  comptesCampagne,
  dateCourte,
  duree,
  etatAppel,
  hauteurTrait,
  heure,
  jourCourt,
  libelleJour,
  numeroMasque,
  parQui,
  prenom,
  prochaineEntreeDue,
  prochaineTentative,
  quandRappeler,
  quandTentative,
  rangTentative,
  rappelEnRetard,
} from './format-appel';

describe('heure de Paris', () => {
  it('passe minuit à Paris avant minuit UTC', () => {
    expect(heure('2026-09-28T22:30:00Z')).toBe('00:30');
    expect(cleJour('2026-09-28T22:30:00Z')).toBe('2026-09-29');
    expect(cleJour('2026-09-28T21:59:00Z')).toBe('2026-09-28');
  });

  it('suit le changement d’heure du 25 octobre 2026', () => {
    // 02:30 existe deux fois cette nuit-là : en heure d'été puis en heure d'hiver.
    expect(heure('2026-10-25T00:30:00Z')).toBe('02:30');
    expect(heure('2026-10-25T01:30:00Z')).toBe('02:30');
    expect(heure('2026-10-25T02:30:00Z')).toBe('03:30');
    expect(cleJour('2026-10-24T22:30:00Z')).toBe('2026-10-25');
    // Le 26 octobre, Paris est à UTC+1 : minuit y tombe à 23:00 UTC.
    expect(cleJour('2026-10-25T22:30:00Z')).toBe('2026-10-25');
    expect(cleJour('2026-10-25T23:30:00Z')).toBe('2026-10-26');
    expect(heure('2026-10-25T23:30:00Z')).toBe('00:30');
  });

  it('formate la date courte et le jour court', () => {
    expect(dateCourte('2026-09-29T12:32:00Z')).toBe('29/09 14:32');
    expect(jourCourt('2026-09-29T12:32:00Z')).toBe('mar. 29/09');
  });

  it('nomme les jours par le calendrier de Paris', () => {
    const maintenant = new Date('2026-10-25T23:30:00Z'); // lundi 26 octobre, 00:30
    expect(libelleJour('2026-10-25T23:10:00Z', maintenant)).toBe('Aujourd’hui');
    expect(libelleJour('2026-10-25T12:00:00Z', maintenant)).toBe('Hier');
    expect(libelleJour('2026-10-24T12:00:00Z', maintenant)).toBe('Samedi 24 octobre');
    expect(libelleJour('2025-10-24T12:00:00Z', maintenant)).toBe('Vendredi 24 octobre 2025');
  });
});

describe('durées', () => {
  it('écrit une durée d’appel', () => {
    expect(duree(47)).toBe('0:47');
    expect(duree(725)).toBe('12:05');
    expect(duree(3723)).toBe('1:02:03');
    expect(duree(0)).toBe('');
    expect(duree(null)).toBe('');
    expect(duree(undefined)).toBe('');
  });

  it('écrit un chrono', () => {
    expect(chrono(102_000)).toBe('01:42');
    expect(chrono(3_723_000)).toBe('1:02:03');
    expect(chrono(-5)).toBe('00:00');
  });
});

describe('identité', () => {
  it('prend le prénom', () => {
    expect(prenom('Julie Martin')).toBe('Julie');
    expect(prenom('  Julie  ')).toBe('Julie');
  });

  it('masque un numéro', () => {
    expect(numeroMasque('06 39 98 00 01')).toBe('06 •• •• •• 01');
    expect(numeroMasque('+44 20 7946 0000')).toBe('+44 •• •••• ••00');
    expect(numeroMasque('1234')).toBe('1234');
  });
});

describe('etatAppel', () => {
  const maintenant = new Date('2026-09-29T12:00:00Z');
  const base = { issueSysteme: null, ligne: 'bluetooth', debutLe: new Date('2026-09-29T11:58:00Z') };

  it('montre un appel vivant en antenne', () => {
    expect(etatAppel({ ...base, statut: 'en-cours' }, { vivant: true, maintenant })).toEqual({ cle: 'en-cours', libelle: 'En cours', ton: 'antenne' });
  });

  it('distingue simulation et navigateur récents', () => {
    expect(etatAppel({ ...base, statut: 'en-cours', ligne: 'simulation' }, { maintenant })).toMatchObject({ cle: 'en-cours', libelle: 'Simulation en cours', ton: 'encre-2' });
    expect(etatAppel({ ...base, statut: 'en-cours', ligne: 'navigateur' }, { maintenant })).toMatchObject({ cle: 'en-cours', libelle: 'En cours (navigateur)', ton: 'encre-2' });
  });

  it('dit « Resté ouvert » quand rien ne le fait vivre', () => {
    expect(etatAppel({ ...base, statut: 'en-cours' }, { maintenant })).toMatchObject({ cle: 'reste-ouvert', libelle: 'Resté ouvert', ton: 'encre-3' });
    const ancien = { ...base, statut: 'en-cours', ligne: 'simulation', debutLe: new Date('2026-09-29T11:40:00Z') };
    expect(etatAppel(ancien, { maintenant })).toMatchObject({ cle: 'reste-ouvert' });
  });

  it('montre l’analyse en cours', () => {
    expect(etatAppel({ ...base, statut: 'traitement' }, { maintenant })).toMatchObject({ cle: 'analyse', libelle: 'Analyse…', ton: 'encre-3' });
  });

  it('distingue un appel pas parti d’une analyse en échec, en graphite', () => {
    expect(etatAppel({ ...base, statut: 'echec', erreur: 'Ligne occupée.' }, { maintenant })).toEqual({
      cle: 'pas-parti',
      libelle: 'Non composé',
      ton: 'encre-2',
      detail: 'Ligne occupée.',
    });
    expect(etatAppel({ ...base, statut: 'echec', conversationId: 'conv-fictive' }, { maintenant })).toEqual({
      cle: 'analyse-echec',
      libelle: 'Analyse en échec',
      ton: 'encre-2',
    });
  });

  it('nomme l’issue, personnalisée d’abord, rendez-vous en encre', () => {
    expect(etatAppel({ ...base, statut: 'termine', issueSysteme: 'refus' }, { maintenant })).toEqual({ cle: 'issue', libelle: 'Refus', ton: 'encre-2' });
    expect(etatAppel({ ...base, statut: 'termine', issueSysteme: 'refus' }, { libellePerso: 'Trop cher', maintenant })).toMatchObject({ libelle: 'Trop cher' });
    expect(etatAppel({ ...base, statut: 'termine', issueSysteme: 'rendez-vous-pris' }, { maintenant })).toMatchObject({ ton: 'encre' });
    expect(etatAppel({ ...base, statut: 'termine', issueSysteme: 'non-abouti' }, { maintenant })).toMatchObject({ cle: 'issue', libelle: 'Non abouti' });
  });

  it('dit « Sans issue » plutôt qu’un tiret', () => {
    expect(etatAppel({ ...base, statut: 'termine' }, { maintenant })).toEqual({ cle: 'sans-issue', libelle: 'Sans issue', ton: 'encre-3' });
  });
});

describe('hauteurTrait', () => {
  const o = { min: 2, max: 14 };
  it('reste minimal sans bilan, à l’étape 0 ou sans nombre d’étapes', () => {
    expect(hauteurTrait(null, 4, o)).toBe(2);
    expect(hauteurTrait(undefined, 4, o)).toBe(2);
    expect(hauteurTrait(0, 4, o)).toBe(2);
    expect(hauteurTrait(2, 0, o)).toBe(2);
    expect(hauteurTrait(2, null, o)).toBe(2);
  });

  it('suit l’étape atteinte, bornée', () => {
    expect(hauteurTrait(2, 4, o)).toBe(8);
    expect(hauteurTrait(4, 4, o)).toBe(14);
    expect(hauteurTrait(6, 4, o)).toBe(14);
  });
});

describe('comptesCampagne', () => {
  it('compte chaque état', () => {
    expect(
      comptesCampagne([
        { prospectId: 'a', etat: 'a-appeler' },
        { prospectId: 'b', etat: 'en-appel', appelId: 'x' },
        { prospectId: 'c', etat: 'appelee', appelId: 'y' },
        { prospectId: 'd', etat: 'sautee', raisonSaut: 'numero-non-appelable' },
        { prospectId: 'e', etat: 'retiree', motif: 'retrait', le: '2026-09-29T10:00:00.000Z', par: 'interface' },
        { prospectId: 'f', etat: 'a-appeler', sauts: 2 },
      ]),
    ).toEqual({ total: 6, aAppeler: 2, aRetenter: 0, enAppel: 1, enAnalyse: 0, appelees: 1, sautees: 1, retirees: 1, traites: 3 });
  });

  it('compte une nouvelle tentative parmi les prospects à appeler, et un bilan en cours comme traité, jamais comme retiré', () => {
    expect(
      comptesCampagne([
        { prospectId: 'a', etat: 'a-appeler', tentative: 2, appelsPrecedents: ['x'], pasAvant: '2026-10-03T12:00:00.000Z' },
        { prospectId: 'b', etat: 'en-analyse', appelId: 'y' },
        { prospectId: 'c', etat: 'a-appeler' },
      ]),
    ).toEqual({ total: 3, aAppeler: 2, aRetenter: 1, enAppel: 0, enAnalyse: 1, appelees: 0, sautees: 0, retirees: 0, traites: 1 });
  });
});

describe('quandRappeler', () => {
  const maintenant = new Date('2026-09-29T08:00:00Z'); // mardi 29 septembre, 10 h à Paris

  it('dit le jour relatif et la précision donnée par le prospect', () => {
    expect(quandRappeler('2026-09-29T12:30:00Z', { heure: '14:30', moment: null }, maintenant)).toBe('aujourd’hui à 14:30');
    expect(quandRappeler('2026-09-30T07:00:00Z', { heure: null, moment: 'matin' }, maintenant)).toBe('demain matin');
    expect(quandRappeler('2026-10-01T12:00:00Z', { heure: null, moment: 'apres-midi' }, maintenant)).toBe('jeu. 01/10 après-midi');
    expect(quandRappeler('2026-10-01T07:00:00Z', { heure: null, moment: null }, maintenant)).toBe('jeu. 01/10');
    expect(quandRappeler('2026-09-28T07:00:00Z', { heure: null, moment: 'matin' }, maintenant)).toBe('hier matin');
  });

  it('sans précision connue, donne l’heure de l’instant', () => {
    expect(quandRappeler('2026-09-29T12:30:00Z', null, maintenant)).toBe('aujourd’hui à 14:30');
  });
});

describe('rappelEnRetard', () => {
  // 29/09 à 20:00, heure de Paris.
  const soir = new Date('2026-09-29T18:00:00Z');
  const matin = new Date('2026-09-29T08:00:00Z');
  it('un jour passé est en retard, un jour à venir ne l’est pas', () => {
    expect(rappelEnRetard('2026-09-28T07:00:00Z', { heure: null, moment: 'matin' }, matin)).toBe(true);
    expect(rappelEnRetard('2026-09-30T07:00:00Z', { heure: null, moment: 'matin' }, soir)).toBe(false);
  });
  it('le jour même : l’heure dite dépassée, le matin après 12 h, l’après-midi après 18 h', () => {
    expect(rappelEnRetard('2026-09-29T09:00:00Z', { heure: '11:00', moment: null }, soir)).toBe(true);
    expect(rappelEnRetard('2026-09-29T09:00:00Z', { heure: '11:00', moment: null }, matin)).toBe(false);
    expect(rappelEnRetard('2026-09-29T07:00:00Z', { heure: null, moment: 'matin' }, matin)).toBe(false);
    expect(rappelEnRetard('2026-09-29T07:00:00Z', { heure: null, moment: 'matin' }, new Date('2026-09-29T10:00:00Z'))).toBe(true);
    expect(rappelEnRetard('2026-09-29T12:00:00Z', { heure: null, moment: 'apres-midi' }, new Date('2026-09-29T15:59:00Z'))).toBe(false);
    expect(rappelEnRetard('2026-09-29T12:00:00Z', { heure: null, moment: 'apres-midi' }, soir)).toBe(true);
  });
  it('un rappel daté du jour seul ne l’est qu’au lendemain', () => {
    expect(rappelEnRetard('2026-09-29T07:00:00Z', { heure: null, moment: null }, soir)).toBe(false);
  });
});

describe('nouvelles tentatives dans la file', () => {
  // Jeudi 1er octobre 2026, 16 h à Paris.
  const maintenant = new Date('2026-10-01T14:00:00Z');
  const demain14h = '2026-10-02T12:00:00.000Z';
  const demain9h = '2026-10-02T07:00:00.000Z';
  const entrees: EntreeCampagne[] = [
    { prospectId: 'a', etat: 'appelee', appelId: 'x' },
    { prospectId: 'b', etat: 'a-appeler', tentative: 2, appelsPrecedents: ['y'], pasAvant: demain14h },
    { prospectId: 'c', etat: 'a-appeler', tentative: 3, appelsPrecedents: ['z', 'w'], pasAvant: '2026-10-01T12:00:00.000Z' },
    { prospectId: 'd', etat: 'a-appeler', tentative: 2, appelsPrecedents: ['v'], pasAvant: demain9h },
    { prospectId: 'e', etat: 'a-appeler' },
  ];

  it('le prochain est le premier dû dans l’ordre de la file : une tentative dont l’heure est passée avant les suivants', () => {
    expect(prochaineEntreeDue(entrees, maintenant)?.prospectId).toBe('c');
    expect(prochaineEntreeDue(entrees.slice(0, 2), maintenant)).toBeUndefined();
    expect(prochaineEntreeDue(entrees, new Date('2026-10-02T12:00:00Z'))?.prospectId).toBe('b');
  });

  it('la prochaine tentative est la plus proche de celles qui attendent, avec leur nombre', () => {
    expect(prochaineTentative(entrees, maintenant)).toEqual({ le: demain9h, nombre: 2 });
    expect(prochaineTentative([{ prospectId: 'e', etat: 'a-appeler' }], maintenant)).toBeNull();
  });

  it('dit le rang et l’heure de la tentative, en heure de Paris', () => {
    expect(rangTentative(2)).toBe('2ᵉ tentative');
    expect(rangTentative(3)).toBe('3ᵉ tentative');
    expect(quandTentative(demain14h, maintenant)).toBe('demain à 14:00');
    expect(quandTentative('2026-10-03T07:00:00.000Z', maintenant)).toBe('sam. 03/10 à 09:00');
    expect(quandTentative('2026-10-01T15:00:00.000Z', maintenant)).toBe('aujourd’hui à 17:00');
  });

  it('dit qui a fait un geste sur la file', () => {
    expect(parQui('mcp')).toBe(' par Claude Code');
    expect(parQui('systeme')).toBe(' par l’application');
    expect(parQui('interface')).toBe('');
  });
});
