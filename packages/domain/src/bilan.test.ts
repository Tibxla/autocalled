import { describe, expect, it } from 'vitest';
import { type ContexteBilan, type TourDeParole, schemaJsonBilan, validerBilan } from './bilan.ts';

const transcription: TourDeParole[] = [
  { role: 'prospect', texte: 'Allô ?', secondes: 0 },
  { role: 'agent', texte: 'Bonjour Julie, c’est Mina, de l’Atelier Vitrine.', secondes: 1.2 },
  { role: 'prospect', texte: 'Ah, on est déjà sur Booking, vous savez.', secondes: 6.5 },
  { role: 'agent', texte: 'D’accord… et Booking, ça vous coûte combien sur une saison ?', secondes: 9 },
  { role: 'prospect', texte: 'Rappelez-moi jeudi, là je suis en plein ménage.', secondes: 15 },
];

const contexte: ContexteBilan = {
  transcription,
  nombreEtapes: 4,
  objectionIds: ['obj-booking'],
  issues: [
    { cle: 'rappel-convenu', systeme: 'rappel-convenu' },
    { cle: 'refus', systeme: 'refus' },
    { cle: 'perso:maquette', systeme: 'envoi-informations' },
  ],
};

const valide = {
  issue: 'rappel-convenu',
  etapeAtteinte: 2,
  objections: [
    {
      objectionId: 'obj-booking',
      libelle: 'Déjà sur Booking',
      levee: false,
      tempsBloquant: 'argumenter',
      citation: 'on est déjà sur Booking',
    },
  ],
  resume: 'Julie est sur Booking et demande à être rappelée jeudi.',
  pointsForts: ['Mina a creusé avant d’argumenter.'],
  pointsFaibles: ['Aucun argument chiffré.'],
  rappel: 'jeudi',
};

describe('validerBilan', () => {
  it('accepte un bilan cohérent avec la transcription', () => {
    const resultat = validerBilan(valide, contexte);

    expect(resultat.ok).toBe(true);
  });

  it('refuse une issue qui n’appartient pas à l’entreprise', () => {
    const resultat = validerBilan({ ...valide, issue: 'perso:inconnue' }, contexte);

    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreurs.join(' ')).toMatch(/issue/);
  });

  it('refuse une citation que le prospect n’a jamais dite', () => {
    const inventee = { ...valide, objections: [{ ...valide.objections[0], citation: 'c’est beaucoup trop cher' }] };

    const resultat = validerBilan(inventee, contexte);

    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreurs.join(' ')).toMatch(/trop cher/);
  });

  it('refuse une citation qui vient de Mina et non du prospect', () => {
    const deMina = { ...valide, objections: [{ ...valide.objections[0], citation: 'ça vous coûte combien sur une saison' }] };

    expect(validerBilan(deMina, contexte).ok).toBe(false);
  });

  it('tolère les différences de casse, d’apostrophe et d’espaces dans une citation', () => {
    const approchee = { ...valide, objections: [{ ...valide.objections[0], citation: 'On est  déjà sur BOOKING' }] };

    expect(validerBilan(approchee, contexte).ok).toBe(true);
  });

  it('refuse une objection répertoriée inconnue, mais accepte une objection nouvelle', () => {
    const inconnue = { ...valide, objections: [{ ...valide.objections[0], objectionId: 'obj-x' }] };
    const nouvelle = { ...valide, objections: [{ ...valide.objections[0], objectionId: null }] };

    expect(validerBilan(inconnue, contexte).ok).toBe(false);
    expect(validerBilan(nouvelle, contexte).ok).toBe(true);
  });

  it('refuse une étape au-delà du script', () => {
    expect(validerBilan({ ...valide, etapeAtteinte: 5 }, contexte).ok).toBe(false);
  });

  it('exige le moment du rappel quand l’issue est un rappel convenu, et seulement dans ce cas', () => {
    expect(validerBilan({ ...valide, rappel: null }, contexte).ok).toBe(false);
    expect(validerBilan({ ...valide, issue: 'refus', rappel: 'jeudi' }, contexte).ok).toBe(false);
    expect(validerBilan({ ...valide, issue: 'refus', rappel: null }, contexte).ok).toBe(true);
  });

  it('refuse une forme invalide avec un message par champ', () => {
    const resultat = validerBilan({ issue: 'refus' }, contexte);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreurs.length).toBeGreaterThan(1);
  });
});

describe('rendez-vous réellement réservé', () => {
  const rdv = { ...contexte, issues: [...contexte.issues, { cle: 'rendez-vous-pris', systeme: 'rendez-vous-pris' as const }] };
  const bilanRdv = { ...valide, issue: 'rendez-vous-pris', rappel: null };

  it('refuse « Rendez-vous pris » quand aucun rendez-vous n’a été réservé', () => {
    const resultat = validerBilan(bilanRdv, { ...rdv, rendezVousReserve: false });

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreurs.join(' ')).toMatch(/aucun rendez-vous/);
  });

  it('accepte « Rendez-vous pris » quand le rendez-vous est réservé, ou quand on ne sait pas', () => {
    expect(validerBilan(bilanRdv, { ...rdv, rendezVousReserve: true }).ok).toBe(true);
    expect(validerBilan(bilanRdv, rdv).ok).toBe(true);
  });
});

describe('schemaJsonBilan', () => {
  it('produit un schéma JSON objet fermé, utilisable comme sortie structurée', () => {
    const schema = schemaJsonBilan() as { type: string; additionalProperties: boolean; required: string[] };

    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('issue');
    expect(schema).not.toHaveProperty('$schema');
  });
});
