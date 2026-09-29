import { describe, expect, it } from 'vitest';
import {
  type Campagne,
  TransitionInvalide,
  ajouterProspects,
  creerCampagne,
  debuterAppel,
  demarrer,
  finDemandee,
  mettreEnPause,
  prochaineAction,
  reporter,
  retirer,
  sauter,
  terminerAppel,
  terminerAvantLaFin,
} from './campagne.ts';

const TRACE = { le: '2026-09-29T10:00:00.000Z', par: 'interface' } as const;

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
    expect(prochaineAction(campagneDeTrois())).toEqual({ type: 'attendre' });
  });

  it('appelle le premier prospect une fois démarrée', () => {
    expect(prochaineAction(demarrer(campagneDeTrois()))).toEqual({ type: 'appeler', prospectId: 'julie' });
  });

  it("n'appelle personne tant qu'un appel est en cours", () => {
    const campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');

    expect(prochaineAction(campagne)).toEqual({ type: 'attendre' });
  });

  it('passe au prospect suivant quand l’appel se termine', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = terminerAppel(campagne, 'appel-1');

    expect(prochaineAction(campagne)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('passe au suivant quand un prospect est sauté', () => {
    const campagne = sauter(demarrer(campagneDeTrois()), 'julie', 'numero-non-autorise');

    expect(prochaineAction(campagne)).toEqual({ type: 'appeler', prospectId: 'marc' });
    expect(campagne.entrees[0]).toMatchObject({ etat: 'sautee', raisonSaut: 'numero-non-autorise' });
  });
});

describe('fin de campagne', () => {
  it('se termine quand le dernier appel se termine', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const [i, prospectId] of ['julie', 'marc', 'lea'].entries()) {
      campagne = debuterAppel(campagne, prospectId, `appel-${i}`);
      campagne = terminerAppel(campagne, `appel-${i}`);
    }

    expect(campagne.statut).toBe('terminee');
    expect(prochaineAction(campagne)).toEqual({ type: 'attendre' });
  });

  it('se termine quand le dernier prospect est sauté', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const prospectId of ['julie', 'marc', 'lea']) campagne = sauter(campagne, prospectId, 'numero-non-autorise');

    expect(campagne.statut).toBe('terminee');
  });

  it('refuse de redémarrer une campagne terminée', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const prospectId of ['julie', 'marc', 'lea']) campagne = sauter(campagne, prospectId, 'numero-non-autorise');

    expect(() => demarrer(campagne)).toThrow(TransitionInvalide);
  });
});

describe('pause', () => {
  it("laisse finir l'appel en cours mais n'en lance pas d'autre", () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = mettreEnPause(campagne);
    campagne = terminerAppel(campagne, 'appel-1');

    expect(campagne.statut).toBe('en-pause');
    expect(prochaineAction(campagne)).toEqual({ type: 'attendre' });
  });

  it('reprend au prospect suivant', () => {
    let campagne = mettreEnPause(demarrer(campagneDeTrois()));
    campagne = demarrer(campagne);

    expect(prochaineAction(campagne)).toEqual({ type: 'appeler', prospectId: 'julie' });
  });

  it('refuse de débuter un appel pendant la pause', () => {
    const campagne = mettreEnPause(demarrer(campagneDeTrois()));

    expect(() => debuterAppel(campagne, 'julie', 'appel-1')).toThrow(TransitionInvalide);
  });

  it("refuse de mettre en pause une campagne qui n'est pas en cours", () => {
    expect(() => mettreEnPause(campagneDeTrois())).toThrow(TransitionInvalide);
  });
});

describe('garde-fous', () => {
  it("refuse de débuter un appel vers un autre prospect que le suivant", () => {
    expect(() => debuterAppel(demarrer(campagneDeTrois()), 'marc', 'appel-1')).toThrow(TransitionInvalide);
  });

  it('refuse un second appel simultané', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = sauter(campagne, 'marc', 'numero-non-autorise');

    expect(() => debuterAppel(campagne, 'lea', 'appel-2')).toThrow(/un seul appel/);
  });

  it('refuse de terminer un appel inconnu', () => {
    expect(() => terminerAppel(demarrer(campagneDeTrois()), 'appel-x')).toThrow(TransitionInvalide);
  });

  it('ne modifie jamais la campagne reçue', () => {
    const avant = demarrer(campagneDeTrois());
    const copie = structuredClone(avant);

    debuterAppel(avant, 'julie', 'appel-1');

    expect(avant).toEqual(copie);
  });
});

describe('reporter (Sauter)', () => {
  it('renvoie le prospect en fin de file, sans l’appeler', () => {
    const campagne = reporter(demarrer(campagneDeTrois()), 'julie');

    expect(campagne.entrees.map((e) => e.prospectId)).toEqual(['marc', 'lea', 'julie']);
    expect(campagne.entrees[2]).toEqual({ prospectId: 'julie', etat: 'a-appeler', sauts: 1 });
    expect(prochaineAction(campagne)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('le place après le dernier prospect à appeler, les entrées closes gardent leur rang', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = terminerAppel(campagne, 'appel-1');
    campagne = reporter(campagne, 'marc');

    expect(campagne.entrees.map((e) => [e.prospectId, e.etat])).toEqual([
      ['julie', 'appelee'],
      ['lea', 'a-appeler'],
      ['marc', 'a-appeler'],
    ]);
  });

  it('compte les sauts successifs', () => {
    let campagne = reporter(demarrer(campagneDeTrois()), 'julie');
    campagne = reporter(campagne, 'marc');
    campagne = reporter(campagne, 'lea');
    campagne = reporter(campagne, 'julie');

    expect(campagne.entrees.find((e) => e.prospectId === 'julie')).toMatchObject({ sauts: 2 });
  });

  it('refuse le dernier à appeler, l’appel en cours et un prospect déjà appelé', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');

    expect(() => reporter(campagne, 'julie')).toThrow(TransitionInvalide);
    expect(() => reporter(campagne, 'lea')).toThrow(/dernier/);
    campagne = terminerAppel(campagne, 'appel-1');
    expect(() => reporter(campagne, 'julie')).toThrow(TransitionInvalide);
  });

  it('se fait aussi sur une campagne prête ou suspendue', () => {
    expect(reporter(campagneDeTrois(), 'julie').statut).toBe('prete');
    expect(reporter(mettreEnPause(demarrer(campagneDeTrois())), 'julie').statut).toBe('en-pause');
  });
});

describe('retirer', () => {
  it('sort le prospect de la file avec sa trace', () => {
    const campagne = retirer(demarrer(campagneDeTrois()), 'julie', TRACE);

    expect(campagne.entrees[0]).toEqual({ prospectId: 'julie', etat: 'retiree', motif: 'retrait', ...TRACE });
    expect(prochaineAction(campagne)).toEqual({ type: 'appeler', prospectId: 'marc' });
  });

  it('refuse l’appel en cours et un prospect déjà appelé ou sauté', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    expect(() => retirer(campagne, 'julie', TRACE)).toThrow(TransitionInvalide);
    campagne = sauter(campagne, 'marc', 'numero-non-autorise');
    expect(() => retirer(campagne, 'marc', TRACE)).toThrow(TransitionInvalide);
  });

  it('termine la campagne quand le dernier prospect restant est retiré', () => {
    let campagne = demarrer(campagneDeTrois());
    for (const p of ['julie', 'marc', 'lea']) campagne = retirer(campagne, p, TRACE);

    expect(campagne.statut).toBe('terminee');
  });

  it('pendant un appel, la campagne attend sa fin pour se terminer', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = retirer(retirer(campagne, 'marc', TRACE), 'lea', TRACE);

    expect(campagne.statut).toBe('en-cours');
    expect(terminerAppel(campagne, 'appel-1').statut).toBe('terminee');
  });
});

describe('ajouterProspects', () => {
  it('ajoute en fin de file, dans l’ordre donné', () => {
    const campagne = ajouterProspects(demarrer(campagneDeTrois()), ['paul', 'anne']);

    expect(campagne.entrees.map((e) => e.prospectId)).toEqual(['julie', 'marc', 'lea', 'paul', 'anne']);
    expect(campagne.entrees.at(-1)).toEqual({ prospectId: 'anne', etat: 'a-appeler' });
  });

  it('refuse un prospect déjà dans la file, même appelé ou retiré, et un doublon dans l’ajout', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
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
    let campagne = debuterAppel(demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] })), 'julie', 'appel-1');
    campagne = ajouterProspects(campagne, ['paul']);
    campagne = terminerAppel(campagne, 'appel-1');

    expect(campagne.statut).toBe('en-cours');
    expect(prochaineAction(campagne)).toEqual({ type: 'appeler', prospectId: 'paul' });
  });
});

describe('terminerAvantLaFin', () => {
  it('sans appel en cours : retire tous les prospects restants et termine tout de suite', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = terminerAppel(campagne, 'appel-1');
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('terminee');
    expect(campagne.entrees.map((e) => e.etat)).toEqual(['appelee', 'retiree', 'retiree']);
    expect(campagne.entrees[1]).toMatchObject({ motif: 'fin-anticipee', le: TRACE.le, par: 'interface' });
    expect(finDemandee(campagne)).toBe(false);
  });

  it('pendant un appel : l’appel va à son terme, puis la campagne est terminée', () => {
    let campagne = debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1');
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('en-cours');
    expect(finDemandee(campagne)).toBe(true);
    expect(prochaineAction(campagne)).toEqual({ type: 'attendre' });

    campagne = terminerAppel(campagne, 'appel-1');
    expect(campagne.statut).toBe('terminee');
    expect(prochaineAction(campagne)).toEqual({ type: 'attendre' });
  });

  it('refuse d’ajouter des prospects tant que la fin est demandée', () => {
    const campagne = terminerAvantLaFin(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1'), TRACE);

    expect(() => ajouterProspects(campagne, ['paul'])).toThrow(/se termine/);
  });

  it('suspendue pendant un appel, elle se termine à la fin de l’appel', () => {
    let campagne = mettreEnPause(debuterAppel(demarrer(campagneDeTrois()), 'julie', 'appel-1'));
    campagne = terminerAvantLaFin(campagne, TRACE);

    expect(campagne.statut).toBe('en-pause');
    expect(terminerAppel(campagne, 'appel-1').statut).toBe('terminee');
  });

  it('termine une campagne prête sans qu’aucun appel ne parte', () => {
    const campagne = terminerAvantLaFin(campagneDeTrois(), TRACE);

    expect(campagne.statut).toBe('terminee');
    expect(() => demarrer(campagne)).toThrow(TransitionInvalide);
  });

  it('refuse une campagne terminée, et une campagne sans prospect restant', () => {
    const terminee = terminerAvantLaFin(campagneDeTrois(), TRACE);
    expect(() => terminerAvantLaFin(terminee, TRACE)).toThrow(TransitionInvalide);

    let dernier = debuterAppel(demarrer(creerCampagne({ id: 'c', entrepriseId: 'e', versionScriptId: 'v', prospectIds: ['julie'] })), 'julie', 'appel-1');
    expect(() => terminerAvantLaFin(dernier, TRACE)).toThrow(/plus aucun prospect/);
    dernier = terminerAppel(dernier, 'appel-1');
    expect(dernier.statut).toBe('terminee');
  });

  it('ne modifie jamais la campagne reçue', () => {
    const avant = demarrer(campagneDeTrois());
    const copie = structuredClone(avant);

    terminerAvantLaFin(avant, TRACE);
    reporter(avant, 'julie');
    retirer(avant, 'marc', TRACE);
    ajouterProspects(avant, ['paul']);

    expect(avant).toEqual(copie);
  });
});
