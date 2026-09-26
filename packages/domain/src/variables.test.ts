import { describe, expect, it } from 'vitest';
import { type ContexteAppel, VARIABLES_DE_L_APPEL, variablesDeLAppel } from './variables.ts';

const contexte: ContexteAppel = {
  entreprise: {
    nom: 'Atelier Vitrine',
    offre: 'Des sites de réservation directe.',
    cible: 'Les loueurs saisonniers.',
    arguments: 'Moins de commission.',
    prixConsigne: '',
    interdits: '',
  },
  prospect: { nom: 'Julie Martin', role: 'Gérante', societe: 'Gîte des Aravis', contexte: 'Quatre chambres.' },
  etapes: [
    { intention: 'Accroche', exemples: ['Bonjour Julie', 'Vous avez deux minutes ?'] },
    { intention: 'Rendez-vous', exemples: [] },
  ],
  objections: [
    {
      libelle: '« On est déjà sur Booking »',
      creuser: 'Ça vous coûte combien ?',
      reformuler: '',
      argumenter: 'Le site récupère les habitués.',
      controler: '',
    },
  ],
  historique: [],
  maintenant: new Date('2026-09-26T08:00:00Z'),
};

describe('variablesDeLAppel', () => {
  it('fournit exactement les variables attendues par le prompt de Mina', () => {
    expect(Object.keys(variablesDeLAppel(contexte)).sort()).toEqual([...VARIABLES_DE_L_APPEL].sort());
  });

  it('écrit la date du jour en toutes lettres, à l’heure de Paris', () => {
    expect(variablesDeLAppel(contexte).date_du_jour).toBe('samedi 26 septembre 2026');
  });

  it('numérote les étapes et cite leurs exemples', () => {
    expect(variablesDeLAppel(contexte).script_etapes).toBe(
      '1. Accroche (par exemple : « Bonjour Julie » ; « Vous avez deux minutes ? »)\n2. Rendez-vous',
    );
  });

  it('décrit chaque objection par ses temps CRAC renseignés seulement', () => {
    expect(variablesDeLAppel(contexte).objections).toBe(
      '« On est déjà sur Booking » : creuser : Ça vous coûte combien ? ; argumenter : Le site récupère les habitués.',
    );
  });

  it('remplace les champs vides par une consigne neutre plutôt que par du vide', () => {
    const v = variablesDeLAppel(contexte);

    expect(v.entreprise_prix_consigne).toBe('pas de consigne particulière.');
    expect(v.entreprise_interdits).toBe('rien de particulier.');
    expect(v.historique_appels).toBe('Aucun échange précédent.');
  });

  it('résume les échanges précédents, du plus ancien au plus récent', () => {
    const v = variablesDeLAppel({
      ...contexte,
      historique: [
        { le: new Date('2026-09-24T09:00:00Z'), issue: 'Rappel convenu', resume: 'Elle demande de rappeler jeudi.' },
        { le: new Date('2026-09-20T09:00:00Z'), issue: 'Non abouti', resume: 'Pas de réponse.' },
      ],
    });

    expect(v.historique_appels).toBe(
      'Le dimanche 20 septembre : Non abouti. Pas de réponse.\nLe jeudi 24 septembre : Rappel convenu. Elle demande de rappeler jeudi.',
    );
  });

  it('se contente du nom quand le rôle ou la société manquent', () => {
    const v = variablesDeLAppel({ ...contexte, prospect: { ...contexte.prospect, role: null, societe: null } });

    expect(v.prospect_role).toBe('responsable');
    expect(v.prospect_societe).toBe('son entreprise');
  });
});

describe('cohérence avec le prompt de Mina', () => {
  it('fournit chaque variable que le prompt utilise, et aucune de trop', async () => {
    const { readFile } = await import('node:fs/promises');
    const prompt = await readFile(new URL('../../../agent/prompt.md', import.meta.url), 'utf8');
    const utilisees = new Set([...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

    expect([...utilisees].sort()).toEqual([...VARIABLES_DE_L_APPEL].sort());
  });
});
