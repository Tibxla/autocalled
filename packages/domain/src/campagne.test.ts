import { describe, expect, it } from 'vitest';
import {
  type Campagne,
  TENTATIVES_MAX,
  TransitionInvalide,
  ajouterProspects,
  annulerDebut,
  classer,
  creerCampagne,
  debuterAppel,
  demarrer,
  finDemandee,
  mettreEnPause,
  prochaineAction,
  prochaineTentative,
  reporter,
  retirer,
  retirerTentativePrevue,
  sansNouvelleTentative,
  sauter,
  terminerAppel,
  terminerAvantLaFin,
  traceDeFin,
} from './campagne.ts';

const TRACE = { le: '2026-09-29T10:00:00.000Z', par: 'interface' } as const;
const MAINTENANT = new Date('2026-09-29T08:00:00.000Z');
/** Fin d'un appel le mardi 29 septembre 2026 à 10 h 30, heure de Paris. */
const FIN = new Date('2026-09-29T08:30:00.000Z');

function campagneDeTrois(): Campagne {
  return creerCampagne({
    id: 'c1',
    entrepriseId: 'e1',
    versionScriptId: 'v1',
    prospectIds: ['julie', 'marc', 'lea'],
  });
}

describe('creerCampagne', () => {
  it('crée une campagne prête, tous les prospects à appeler', () => {
    const campagne = campagneDeTrois();

    expect(campagne.statut).toBe('prete');
    expect(campagne.entrees.map((e) => e.etat)).toEqual(['a-appeler', 'a-appeler', 'a-appeler']);
  });

  it('refuse une campagne vide', () => {
    expect(() => creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: [] })).toThrow(
      TransitionInvalide,
    );
  });

  it('refuse un prospect présent deux fois', () => {
    expect(() =>
      creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie', 'julie'] }),
    ).toThrow(/deux fois/);
  });
});

describe('prochaineAction', () => {
  it("attend tant que la campagne n'est pas démarrée", () => {
    expect(prochaineAction(campagneDeTrois(), MAINTENANT)).toEqual({ type: 'attendre' });
  });

  it('appelle le premier prospect une fois démarrée', () => {
    expect(prochaineAction(demarrer(campagneDeTrois()), MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'julie' });
  });

  it("n'appelle personne tant qu'un appel est en cours", () => {
    const campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);

    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });
  });

  it('passe au prospect suivant quand l’appel se termine', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAppel(campagne, 'appel-1');

    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('passe au suivant quand un prospect est sauté', () => {
    const campagne = sauter(demarrer(campagneDeTrois()), 'julie', 'numero-non-appelable');

    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'marc' });
    expect(campagne.entrees[0]).toMatchObject({ etat: 'sautee', raisonSaut: 'numero-non-appelable' });
  });
});

describe('fin de campagne', () => {
  it('se termine quand le dernier appel se termine', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const [i, prospectId] of ['julie', 'marc', 'lea'].entries()) {
      campagne = debuterAppel(campagne, prospectId, `appel-${i}`, MAINTENANT);
      campagne = terminerAppel(campagne, `appel-${i}`, 'refus', FIN);
    }

    expect(campagne.statut).toBe('terminee');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });
  });

  it('se termine quand le dernier prospect est sauté', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const prospectId of ['julie', 'marc', 'lea']) campagne = sauter(campagne, prospectId, 'numero-non-appelable');

    expect(campagne.statut).toBe('terminee');
  });

  it('refuse de redémarrer une campagne terminée', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const prospectId of ['julie', 'marc', 'lea']) campagne = sauter(campagne, prospectId, 'numero-non-appelable');

    expect(() => demarrer(campagne)).toThrow(TransitionInvalide);
  });
});

describe('pause', () => {
  it("laisse finir l'appel en cours mais n'en lance pas d'autre", () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = mettreEnPause(campagne);
    campagne = terminerAppel(campagne, 'appel-1');

    expect(campagne.statut).toBe('en-pause');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });
  });

  it('reprend au prospect suivant', () => {
    let campagne = mettreEnPause(demarrer(campagneDeTrois()));
    campagne = demarrer(campagne);

    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'julie' });
  });

  it('refuse de débuter un appel pendant la pause', () => {
    const campagne = mettreEnPause(demarrer(campagneDeTrois()));

    expect(() => debuterAppel(campagne, 'julie', 'appel-1', MAINTENANT)).toThrow(TransitionInvalide);
  });

  it("refuse de mettre en pause une campagne qui n'est pas en cours", () => {
    expect(() => mettreEnPause(campagneDeTrois())).toThrow(TransitionInvalide);
  });
});

describe('garde-fous', () => {
  it("refuse de débuter un appel vers un autre prospect que le suivant", () => {
    expect(() => debuterAppel(demarrer(campagneDeTrois()), 'marc', 'appel-1', MAINTENANT)).toThrow(TransitionInvalide);
  });

  it('refuse un second appel simultané', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = sauter(campagne, 'marc', 'numero-non-appelable');

    expect(() => debuterAppel(campagne, 'lea', 'appel-2', MAINTENANT)).toThrow(/un seul appel/);
  });

  it('refuse de terminer un appel inconnu', () => {
    expect(() => terminerAppel(demarrer(campagneDeTrois()), 'appel-x')).toThrow(TransitionInvalide);
  });

  it('ne modifie jamais la campagne reçue', () => {
    const avant = demarrer(campagneDeTrois());
    const copie = structuredClone(avant);

    debuterAppel(avant, 'julie', 'appel-1', MAINTENANT);

    expect(avant).toEqual(copie);
  });
});

describe('reporter (Sauter)', () => {
  it('renvoie le prospect en fin de file, sans l’appeler', () => {
    const campagne = reporter(demarrer(campagneDeTrois()), 'julie', MAINTENANT);

    expect(campagne.entrees.map((e) => e.prospectId)).toEqual(['marc', 'lea', 'julie']);
    expect(campagne.entrees[2]).toEqual({ prospectId: 'julie', etat: 'a-appeler', sauts: 1 });
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('le place après le dernier prospect à appeler, les entrées closes gardent leur rang', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAppel(campagne, 'appel-1', 'refus', FIN);
    campagne = reporter(campagne, 'marc', MAINTENANT);

    expect(campagne.entrees.map((e) => [e.prospectId, e.etat])).toEqual([
      ['julie', 'appelee'],
      ['lea', 'a-appeler'],
      ['marc', 'a-appeler'],
    ]);
  });

  it('compte les sauts successifs', () => {
    let campagne = reporter(demarrer(campagneDeTrois()), 'julie', MAINTENANT);
    campagne = reporter(campagne, 'marc', MAINTENANT);
    campagne = reporter(campagne, 'lea', MAINTENANT);
    campagne = reporter(campagne, 'julie', MAINTENANT);

    expect(campagne.entrees.find((e) => e.prospectId === 'julie')).toMatchObject({ sauts: 2 });
  });

  it('refuse le dernier à appeler, l’appel en cours et un prospect déjà appelé', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);

    expect(() => reporter(campagne, 'julie', MAINTENANT)).toThrow(TransitionInvalide);
    expect(() => reporter(campagne, 'lea', MAINTENANT)).toThrow(/dernier/);
    campagne = terminerAppel(campagne, 'appel-1');
    expect(() => reporter(campagne, 'julie', MAINTENANT)).toThrow(TransitionInvalide);
  });

  it('se fait aussi sur une campagne prête ou suspendue', () => {
    expect(reporter(campagneDeTrois(), 'julie', MAINTENANT).statut).toBe('prete');
    expect(reporter(mettreEnPause(demarrer(campagneDeTrois())), 'julie', MAINTENANT).statut).toBe('en-pause');
  });
});

describe('retirer', () => {
  it('sort le prospect de la file avec sa trace', () => {
    const campagne = retirer(demarrer(campagneDeTrois()), 'julie', TRACE);

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'retiree', motif: 'retrait', ...TRACE });
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('refuse l’appel en cours et un prospect déjà appelé ou sauté', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    expect(() => retirer(campagne, 'julie', TRACE)).toThrow(TransitionInvalide);
    campagne = sauter(campagne, 'marc', 'numero-non-appelable');
    expect(() => retirer(campagne, 'marc', TRACE)).toThrow(TransitionInvalide);
  });

  it('termine la campagne quand le dernier prospect restant est retiré', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const p of ['julie', 'marc', 'lea']) campagne = retirer(campagne, p, TRACE);

    expect(campagne.statut).toBe('terminee');
  });

  it('pendant un appel, la campagne attend sa fin pour se terminer', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = retirer(retirer(campagne, 'marc', TRACE), 'lea', TRACE);

    expect(campagne.statut).toBe('en-cours');
    expect(terminerAppel(campagne, 'appel-1', 'refus', FIN).statut).toBe('terminee');
  });
});

describe('ajouterProspects', () => {
  it('ajoute en fin de file, dans l’ordre donné', () => {
    const campagne = ajouterProspects(demarrer(campagneDeTrois()), ['paul', 'anne']);

    expect(campagne.entrees.map((e) => e.prospectId)).toEqual(['julie', 'marc', 'lea', 'paul', 'anne']);
    expect(campagne.entrees.at(-1)).toEqual({ prospectId: 'anne', etat: 'a-appeler' });
  });

  it('refuse un prospect déjà dans la file, même appelé ou retiré, et un doublon dans l’ajout', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAppel(campagne, 'appel-1');
    campagne = retirer(campagne, 'marc', TRACE);

    expect(() => ajouterProspects(campagne, ['julie'])).toThrow(/déjà dans la file/);
    expect(() => ajouterProspects(campagne, ['marc'])).toThrow(/déjà dans la file/);
    expect(() => ajouterProspects(campagne, ['paul', 'paul'])).toThrow(/déjà dans la file/);
    expect(() => ajouterProspects(campagne, [])).toThrow(TransitionInvalide);
  });

  it('refuse une campagne terminée', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const p of ['julie', 'marc', 'lea']) campagne = retirer(campagne, p, TRACE);

    expect(() => ajouterProspects(campagne, ['paul'])).toThrow(TransitionInvalide);
  });

  it('relance la file d’une campagne dont l’appel en cours était le dernier', () => {
    let campagne = debuterAppel(demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] })), 'julie', 'appel-1', MAINTENANT);
    campagne = ajouterProspects(campagne, ['paul']);
    campagne = terminerAppel(campagne, 'appel-1');

    expect(campagne.statut).toBe('en-cours');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'paul' });
  });
});

describe('terminerAvantLaFin', () => {
  it('sans appel en cours : retire tous les prospects restants et termine tout de suite', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAppel(campagne, 'appel-1');
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('terminee');
    expect(campagne.entrees.map((e) => e.etat)).toEqual(['appelee', 'retiree', 'retiree']);
    expect(campagne.entrees[1]).toMatchObject({ motif: 'fin-anticipee', le: TRACE.le, par: 'interface' });
    expect(finDemandee(campagne)).toBe(false);
  });

  it('pendant un appel : l’appel va à son terme, puis la campagne est terminée', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('en-cours');
    expect(finDemandee(campagne)).toBe(true);
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });

    campagne = terminerAppel(campagne, 'appel-1', 'refus', FIN);
    expect(campagne.statut).toBe('terminee');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });
  });

  it('refuse d’ajouter des prospects tant que la fin est demandée', () => {
    const campagne = terminerAvantLaFin(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT), TRACE);

    expect(() => ajouterProspects(campagne, ['paul'])).toThrow(/se termine/);
  });

  it('suspendue pendant un appel, elle se termine à la fin de l’appel', () => {
    let campagne = mettreEnPause(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT));
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('en-pause');
    expect(terminerAppel(campagne, 'appel-1', 'refus', FIN).statut).toBe('terminee');
  });

  it('termine une campagne prête sans qu’aucun appel ne parte', () => {
    const campagne = terminerAvantLaFin(campagneDeTrois(), TRACE);

    expect(campagne.statut).toBe('terminee');
    expect(() => demarrer(campagne)).toThrow(TransitionInvalide);
  });

  it('refuse une campagne terminée, et une fin déjà demandée', () => {
    const terminee = terminerAvantLaFin(campagneDeTrois(), TRACE);
    expect(() => terminerAvantLaFin(terminee, TRACE)).toThrow(TransitionInvalide);

    const enCours = terminerAvantLaFin(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT), TRACE);
    expect(() => terminerAvantLaFin(enCours, TRACE)).toThrow(/déjà/);
  });

  it('pendant le dernier appel en ligne : la trace va sur l’appel, qui ne sera pas retenté', () => {
    let dernier = debuterAppel(demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] })), 'julie', 'appel-1', MAINTENANT);
    dernier = terminerAvantLaFin(dernier, TRACE);

    expect(dernier.entrees[0]).toEqual({ prospectId: 'julie', etat: 'en-appel', appelId: 'appel-1', finDemandee: TRACE });
    expect(finDemandee(dernier)).toBe(true);
    expect(traceDeFin(dernier)).toEqual(TRACE);
    expect(() => ajouterProspects(dernier, ['paul'])).toThrow(/se termine/);

    dernier = terminerAppel(dernier, 'appel-1');
    expect(dernier.entrees[0]).toMatchObject({ etat: 'en-analyse', finDemandee: TRACE });
    expect(dernier.statut).toBe('en-cours');
    dernier = classer(dernier, 'appel-1', 'non-abouti', FIN);
    expect(dernier.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    expect(dernier.statut).toBe('terminee');
  });

  it('ne modifie jamais la campagne reçue', () => {
    const avant = demarrer(campagneDeTrois());
    const copie = structuredClone(avant);

    terminerAvantLaFin(avant, TRACE);
    reporter(avant, 'julie', MAINTENANT);
    retirer(avant, 'marc', TRACE);
    ajouterProspects(avant, ['paul']);

    expect(avant).toEqual(copie);
  });
});

describe('prochaineTentative', () => {
  it('avant 13 h, retente le lendemain à 14 h, heure de Paris', () => {
    expect(prochaineTentative(new Date('2026-09-29T08:30:00Z'))).toBe('2026-09-30T12:00:00.000Z');
    expect(prochaineTentative(new Date('2026-09-29T10:59:59Z'))).toBe('2026-09-30T12:00:00.000Z');
  });

  it('à partir de 13 h, retente le lendemain à 9 h', () => {
    expect(prochaineTentative(new Date('2026-09-29T11:00:00Z'))).toBe('2026-09-30T07:00:00.000Z');
    expect(prochaineTentative(new Date('2026-09-29T16:45:00Z'))).toBe('2026-09-30T07:00:00.000Z');
  });

  it('compte le lendemain à l’heure de Paris, pas en UTC', () => {
    // 23 h 30 le 29 à Paris : lendemain 30 septembre, 9 h.
    expect(prochaineTentative(new Date('2026-09-29T21:30:00Z'))).toBe('2026-09-30T07:00:00.000Z');
    // 0 h 30 le 30 à Paris (encore le 29 en UTC) : lendemain 1ᵉʳ octobre, 14 h.
    expect(prochaineTentative(new Date('2026-09-29T22:30:00Z'))).toBe('2026-10-01T12:00:00.000Z');
  });

  it('travaille le week-end : un samedi est retenté le dimanche', () => {
    expect(prochaineTentative(new Date('2026-10-03T09:00:00Z'))).toBe('2026-10-04T12:00:00.000Z');
  });

  it('passe à l’heure d’hiver sans décaler l’heure de Paris', () => {
    // Samedi 24 octobre (heure d'été) → dimanche 25 octobre (heure d'hiver, UTC+1).
    expect(prochaineTentative(new Date('2026-10-24T08:00:00Z'))).toBe('2026-10-25T13:00:00.000Z');
    expect(prochaineTentative(new Date('2026-10-24T12:00:00Z'))).toBe('2026-10-25T08:00:00.000Z');
  });

  it('passe d’une année à l’autre', () => {
    expect(prochaineTentative(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01T08:00:00.000Z');
  });

  it('refuse une fin d’appel invalide plutôt que d’écrire une échéance vide', () => {
    expect(() => prochaineTentative(new Date('pas une date'))).toThrow(TransitionInvalide);
  });
});

/** Un appel à la tête de la file, fini à `fin` avec l'issue donnée. */
function appeler(campagne: Campagne, prospectId: string, appelId: string, issue: Parameters<typeof classer>[2], fin = FIN, maintenant = MAINTENANT) {
  return terminerAppel(debuterAppel(campagne, prospectId, appelId, maintenant), appelId, issue, fin);
}

describe('nouvelles tentatives', () => {
  const DEMAIN_14H = '2026-09-30T12:00:00.000Z';
  const APRES_DEMAIN = new Date('2026-10-01T12:00:00Z');

  it('un appel sans réponse repasse à appeler à sa place, pas avant le lendemain au moment opposé', () => {
    const campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti');

    expect(campagne.entrees[0]).toEqual({
      prospectId: 'julie',
      etat: 'a-appeler',
      tentative: 2,
      appelsPrecedents: ['appel-1'],
      pasAvant: DEMAIN_14H,
    });
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('une tentative due passe avant les prospects plus bas dans la file', () => {
    const campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti');

    expect(prochaineAction(campagne, new Date(DEMAIN_14H))).toEqual({ type: 'appeler', prospectId: 'julie' });
  });

  it('attend la plus proche tentative quand plus rien n’est dû', () => {
    let campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti');
    // Marc, appelé l'après-midi, est retenté le lendemain matin : avant Julie.
    campagne = appeler(campagne, 'marc', 'appel-2', 'non-abouti', new Date('2026-09-29T11:30:00Z'));
    campagne = appeler(campagne, 'lea', 'appel-3', 'refus');

    expect(campagne.statut).toBe('en-cours');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre', jusqua: '2026-09-30T07:00:00.000Z' });
    expect(prochaineAction(campagne, new Date('2026-09-30T07:00:00Z'))).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('attend sans échéance pendant un appel ou en pause', () => {
    let campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti');
    campagne = debuterAppel(campagne, 'marc', 'appel-2', MAINTENANT);

    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });
    expect(prochaineAction(mettreEnPause(campagne), MAINTENANT)).toEqual({ type: 'attendre' });
  });

  it('refuse d’appeler une tentative avant son heure, l’accepte ensuite et lui garde son numéro', () => {
    const campagne = appeler(retirer(retirer(demarrer(campagneDeTrois()), 'marc', TRACE), 'lea', TRACE), 'julie', 'appel-1', 'non-abouti');

    expect(() => debuterAppel(campagne, 'julie', 'appel-2', MAINTENANT)).toThrow(TransitionInvalide);
    expect(debuterAppel(campagne, 'julie', 'appel-2', new Date(DEMAIN_14H)).entrees[0]).toEqual({
      prospectId: 'julie',
      etat: 'en-appel',
      appelId: 'appel-2',
      tentative: 2,
      appelsPrecedents: ['appel-1'],
    });
  });

  it(`s’arrête à ${TENTATIVES_MAX} tentatives : la dernière sans réponse est appelée, et la campagne se termine`, () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));
    let campagne = appeler(seule, 'julie', 'appel-1', 'non-abouti');
    campagne = appeler(campagne, 'julie', 'appel-2', 'non-abouti', new Date(DEMAIN_14H), new Date(DEMAIN_14H));
    expect(campagne.entrees[0]).toMatchObject({ etat: 'a-appeler', tentative: 3, appelsPrecedents: ['appel-1', 'appel-2'] });
    expect(campagne.entrees[0]).toMatchObject({ pasAvant: '2026-10-01T07:00:00.000Z' });

    campagne = appeler(campagne, 'julie', 'appel-3', 'non-abouti', APRES_DEMAIN, APRES_DEMAIN);

    expect(campagne.entrees[0]).toEqual({
      prospectId: 'julie',
      etat: 'appelee',
      appelId: 'appel-3',
      tentative: 3,
      appelsPrecedents: ['appel-1', 'appel-2'],
    });
    expect(campagne.statut).toBe('terminee');
  });

  it('une seule tentative en attente empêche la fin de la campagne', () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));
    const campagne = appeler(seule, 'julie', 'appel-1', 'non-abouti');

    expect(campagne.statut).toBe('en-cours');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre', jusqua: DEMAIN_14H });
  });

  it('toute autre issue, ou une analyse en échec, clôt l’entrée sans nouvelle tentative', () => {
    for (const issue of ['refus', 'rendez-vous-pris', 'rappel-convenu', 'interrompu', null] as const) {
      const campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', issue);
      expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    }
  });

  it('suspendue, la campagne prévoit quand même la nouvelle tentative', () => {
    let campagne = mettreEnPause(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT));
    campagne = terminerAppel(campagne, 'appel-1', 'non-abouti', FIN);

    expect(campagne.statut).toBe('en-pause');
    expect(campagne.entrees[0]).toMatchObject({ etat: 'a-appeler', tentative: 2 });
  });
});

describe('appel en analyse', () => {
  it('sans issue, l’entrée attend son classement sans bloquer la file', () => {
    const campagne = terminerAppel(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT), 'appel-1');

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'en-analyse', appelId: 'appel-1' });
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('empêche la fin de la campagne jusqu’à son classement, qui peut relancer une tentative', () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));
    let campagne = terminerAppel(debuterAppel(seule, 'julie', 'appel-1', MAINTENANT), 'appel-1');

    expect(campagne.statut).toBe('en-cours');
    expect(prochaineAction(campagne, MAINTENANT)).toEqual({ type: 'attendre' });

    campagne = classer(campagne, 'appel-1', 'non-abouti', FIN);
    expect(campagne.statut).toBe('en-cours');
    expect(campagne.entrees[0]).toMatchObject({ etat: 'a-appeler', tentative: 2, pasAvant: '2026-09-30T12:00:00.000Z' });
  });

  it('classée sur une autre issue, l’entrée est appelée et la campagne peut se terminer', () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));
    const campagne = classer(terminerAppel(debuterAppel(seule, 'julie', 'appel-1', MAINTENANT), 'appel-1'), 'appel-1', 'refus', FIN);

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    expect(campagne.statut).toBe('terminee');
  });

  it('classer est idempotent : un appel déjà classé ou inconnu laisse la campagne telle quelle', () => {
    const campagne = classer(terminerAppel(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT), 'appel-1'), 'appel-1', 'non-abouti', FIN);

    expect(classer(campagne, 'appel-1', 'refus', FIN)).toBe(campagne);
    expect(classer(campagne, 'appel-x', 'non-abouti', FIN)).toBe(campagne);
  });

  it('fin demandée : l’appel classé sans réponse n’est pas retenté', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAvantLaFin(campagne, TRACE);
    campagne = terminerAppel(campagne, 'appel-1');
    expect(campagne.statut).toBe('en-cours');

    campagne = classer(campagne, 'appel-1', 'non-abouti', FIN);
    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    expect(campagne.statut).toBe('terminee');
  });
});

describe('gestes sur une nouvelle tentative', () => {
  function avecTentative() {
    return appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti');
  }

  it('reporter est refusé quand seules des tentatives à venir suivent : le prospect resterait le prochain appelé', () => {
    let campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'refus');
    campagne = appeler(campagne, 'marc', 'appel-2', 'non-abouti');
    campagne = reporter(campagne, 'marc', MAINTENANT);
    expect(campagne.entrees.map((e) => e.prospectId)).toEqual(['julie', 'lea', 'marc']);
    // Seule la tentative de Marc, prévue demain, suit Léa : la renvoyer derrière elle ne changerait rien maintenant.
    expect(() => reporter(campagne, 'lea', MAINTENANT)).toThrow(/dernier/);
    expect(() => reporter(campagne, 'lea', new Date('2026-09-30T13:00:00.000Z'))).not.toThrow();
  });

  it('reporter la renvoie en fin de file sans perdre son heure ni son numéro', () => {
    const campagne = reporter(avecTentative(), 'julie', MAINTENANT);

    expect(campagne.entrees.at(-1)).toEqual({
      prospectId: 'julie',
      etat: 'a-appeler',
      sauts: 1,
      tentative: 2,
      appelsPrecedents: ['appel-1'],
      pasAvant: '2026-09-30T12:00:00.000Z',
    });
  });

  it('retirer et sauter l’acceptent avant son heure, et gardent ses appels passés', () => {
    expect(retirer(avecTentative(), 'julie', TRACE).entrees[0]).toEqual({
      prospectId: 'julie',
      etat: 'retiree',
      motif: 'retrait',
      ...TRACE,
      appelsPrecedents: ['appel-1'],
    });
    expect(sauter(avecTentative(), 'julie', 'numero-non-appelable').entrees[0]).toEqual({
      prospectId: 'julie',
      etat: 'sautee',
      raisonSaut: 'numero-non-appelable',
      appelsPrecedents: ['appel-1'],
    });
  });

  it('terminer avant la fin retire les tentatives à venir et tient un appel en analyse pour appelé', () => {
    let campagne = avecTentative();
    campagne = terminerAppel(debuterAppel(campagne, 'marc', 'appel-2', MAINTENANT), 'appel-2');
    campagne = retirer(campagne, 'lea', TRACE);
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('terminee');
    expect(campagne.entrees).toEqual([
      { prospectId: 'julie', etat: 'retiree', motif: 'fin-anticipee', ...TRACE, appelsPrecedents: ['appel-1'] },
      { prospectId: 'marc', etat: 'appelee', appelId: 'appel-2' },
      { prospectId: 'lea', etat: 'retiree', motif: 'retrait', ...TRACE },
    ]);
  });

  it('terminer pendant un appel en ligne, quand plus personne n’attend : son issue sans réponse ne crée plus de tentative', () => {
    let campagne = retirer(retirer(demarrer(campagneDeTrois()), 'marc', TRACE), 'lea', TRACE);
    campagne = debuterAppel(campagne, 'julie', 'appel-1', MAINTENANT);
    campagne = terminerAvantLaFin(campagne, TRACE);

    campagne = terminerAppel(campagne, 'appel-1', 'non-abouti', FIN);
    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    expect(campagne.statut).toBe('terminee');
  });

  it('terminer avec un appel en analyse et un appel en ligne : ni l’un ni l’autre ne sera retenté', () => {
    let campagne = terminerAppel(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT), 'appel-1');
    campagne = retirer(campagne, 'lea', TRACE);
    campagne = debuterAppel(campagne, 'marc', 'appel-2', MAINTENANT);
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    expect(finDemandee(campagne)).toBe(true);
    campagne = terminerAppel(campagne, 'appel-2', 'non-abouti', FIN);
    expect(campagne.entrees[1]).toEqual({ prospectId: 'marc', etat: 'appelee', appelId: 'appel-2' });
    expect(campagne.statut).toBe('terminee');
  });
});

describe('annulerDebut (composition refusée par le pont)', () => {
  it('l’entrée redevient à appeler avec son historique, sans rien consommer', () => {
    const campagne = appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti');
    expect(annulerDebut(debuterAppel(campagne, 'marc', 'appel-2', MAINTENANT), 'appel-2').entrees[1]).toEqual({ prospectId: 'marc', etat: 'a-appeler' });

    const tard = new Date('2026-09-30T13:00:00.000Z');
    const retente = debuterAppel(appeler(campagne, 'marc', 'appel-2', 'refus'), 'julie', 'appel-3', tard);
    expect(annulerDebut(retente, 'appel-3').entrees[0]).toEqual({ prospectId: 'julie', etat: 'a-appeler', tentative: 2, appelsPrecedents: ['appel-1'] });
    expect(prochaineAction(annulerDebut(retente, 'appel-3'), tard)).toEqual({ type: 'appeler', prospectId: 'julie' });
  });

  it('fin demandée entre-temps : l’entrée est retirée et la campagne se termine', () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));
    const campagne = annulerDebut(terminerAvantLaFin(debuterAppel(seule, 'julie', 'appel-1', MAINTENANT), TRACE), 'appel-1');

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'retiree', motif: 'fin-anticipee', ...TRACE });
    expect(campagne.statut).toBe('terminee');
  });

  it('refuse un appel qui n’est pas en cours', () => {
    expect(() => annulerDebut(demarrer(campagneDeTrois()), 'appel-x')).toThrow(TransitionInvalide);
  });
});

describe('sansNouvelleTentative', () => {
  it('tient l’appel en analyse pour appelé, sans toucher au reste', () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));
    const enAnalyse = terminerAppel(debuterAppel(seule, 'julie', 'appel-1', MAINTENANT), 'appel-1');
    const campagne = sansNouvelleTentative(enAnalyse, 'julie');

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'appelee', appelId: 'appel-1' });
    expect(campagne.statut).toBe('terminee');
    expect(classer(campagne, 'appel-1', 'non-abouti', FIN)).toBe(campagne);
    expect(sansNouvelleTentative(campagne, 'julie')).toBe(campagne);
  });
});

describe('retirerTentativePrevue', () => {
  const LE = new Date('2026-09-29T15:00:00.000Z');

  it('retire la nouvelle tentative d’un prospect qui a rappelé, avec la trace de l’application', () => {
    const campagne = retirerTentativePrevue(appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti'), 'julie', LE);

    expect(campagne.entrees[0]).toEqual({
      prospectId: 'julie',
      etat: 'retiree',
      motif: 'rappel-entrant',
      le: '2026-09-29T15:00:00.000Z',
      par: 'systeme',
      appelsPrecedents: ['appel-1'],
    });
    expect(finDemandee(campagne)).toBe(false);
  });

  it('termine la campagne quand c’était tout ce qui restait', () => {
    const seule = demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] }));

    expect(retirerTentativePrevue(appeler(seule, 'julie', 'appel-1', 'non-abouti'), 'julie', LE).statut).toBe('terminee');
  });

  it('laisse telle quelle une entrée sans tentative prévue', () => {
    const jamaisAppele = demarrer(campagneDeTrois());
    const enAppel = debuterAppel(jamaisAppele, 'julie', 'appel-1', MAINTENANT);
    const appele = appeler(jamaisAppele, 'julie', 'appel-1', 'refus');

    expect(retirerTentativePrevue(jamaisAppele, 'julie', LE)).toBe(jamaisAppele);
    expect(retirerTentativePrevue(enAppel, 'julie', LE)).toBe(enAppel);
    expect(retirerTentativePrevue(appele, 'julie', LE)).toBe(appele);
    expect(retirerTentativePrevue(appele, 'inconnu', LE)).toBe(appele);
  });

  it('est idempotent', () => {
    const une = retirerTentativePrevue(appeler(demarrer(campagneDeTrois()), 'julie', 'appel-1', 'non-abouti'), 'julie', LE);

    expect(retirerTentativePrevue(une, 'julie', LE)).toBe(une);
  });
});

describe('tentatives : immutabilité', () => {
  it('ne modifie jamais la campagne reçue', () => {
    const enAppel = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1', MAINTENANT);
    const enAnalyse = terminerAppel(enAppel, 'appel-1');
    const avecTentative = classer(enAnalyse, 'appel-1', 'non-abouti', FIN);
    const copies = [enAppel, enAnalyse, avecTentative].map((c) => structuredClone(c));

    terminerAppel(enAppel, 'appel-1', 'non-abouti', FIN);
    classer(enAnalyse, 'appel-1', 'non-abouti', FIN);
    terminerAvantLaFin(enAnalyse, TRACE);
    retirerTentativePrevue(avecTentative, 'julie', new Date());
    reporter(avecTentative, 'julie', MAINTENANT);

    expect([enAppel, enAnalyse, avecTentative]).toEqual(copies);
  });
});
