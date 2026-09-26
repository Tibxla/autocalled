import { describe, expect, it } from 'vitest';
import {
  type Campagne,
  TransitionInvalide,
  creerCampagne,
  debuterAppel,
  demarrer,
  mettreEnPause,
  prochaineAction,
  sauter,
  terminerAppel,
} from './campagne.ts';

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
