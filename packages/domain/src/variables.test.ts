import { describe, expect, it } from 'vitest';
import { type ContexteAppel, VARIABLES_DE_L_APPEL, variablesDeLAppel } from './variables.ts';

const contexte: ContexteAppel = {
  assistante: { nom: 'Mina' },
  entreprise: {
    nom: 'Atelier Vitrine',
    offre: 'Des sites de réservation directe.',
    cible: 'Les loueurs saisonniers.',
    arguments: 'Moins de commission.',
    prixConsigne: '',
    interdits: '',
    complements: '',
  },
  prospect: { nom: 'Julie Martin', role: 'Gérante', societe: 'Gîte des Aravis', contexte: 'Quatre chambres.', email: null },
  rendezVous: { interlocuteur: 'Camille', dureeMinutes: 30 },
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
  it('fournit exactement les variables attendues par le prompt de l’assistante', () => {
    expect(Object.keys(variablesDeLAppel(contexte)).sort()).toEqual([...VARIABLES_DE_L_APPEL].sort());
  });

  it('donne le nom choisi pour l’assistante', () => {
    expect(variablesDeLAppel({ ...contexte, assistante: { nom: 'Lina' } }).assistante_nom).toBe('Lina');
  });

  it('écrit la date du jour en toutes lettres, à l’heure de Paris', () => {
    expect(variablesDeLAppel(contexte).date_du_jour).toBe('samedi 26 septembre 2026');
  });

  it('remplace les variables citées dans les étapes et les objections, et laisse une inconnue telle quelle', () => {
    const v = variablesDeLAppel({
      ...contexte,
      assistante: { nom: 'Lina' },
      etapes: [{ intention: 'Se présenter comme {{assistante_nom}} de {{ entreprise_nom }}', exemples: ['Bonjour, je parle bien à {{prospect_nom}}, de {{prospect_societe}} ?'] }],
      objections: [{ libelle: 'Pas le temps', creuser: 'Qu’est-ce qui occupe {{prospect_societe}} en ce moment ?', reformuler: '', argumenter: '{{inconnue}} reste', controler: '' }],
    });
    expect(v.script_etapes).toBe('1. Se présenter comme Lina de Atelier Vitrine (par exemple : « Bonjour, je parle bien à Julie Martin, de Gîte des Aravis ? »)');
    expect(v.objections).toBe('Pas le temps : creuser : Qu’est-ce qui occupe Gîte des Aravis en ce moment ? ; argumenter : {{inconnue}} reste');
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

  it('ne transmet rien pour un champ vide de la fiche de l’entreprise : la variable part vide', () => {
    const v = variablesDeLAppel({
      ...contexte,
      entreprise: { nom: 'Atelier Vitrine', offre: '  ', cible: '', arguments: '\n', prixConsigne: '', interdits: '', complements: ' \n ' },
    });

    expect(v.entreprise_offre).toBe('');
    expect(v.entreprise_cible).toBe('');
    expect(v.entreprise_arguments).toBe('');
    expect(v.entreprise_prix_consigne).toBe('');
    expect(v.entreprise_interdits).toBe('');
    expect(v.entreprise_complements).toBe('');
    expect(v.historique_appels).toBe('Aucun échange précédent.');
  });

  it('transmet les informations complémentaires telles qu’écrites, sans leurs blancs de bord', () => {
    const v = variablesDeLAppel({ ...contexte, entreprise: { ...contexte.entreprise, complements: '\nParking : gratuit devant le gîte.\nAnimaux acceptés.  ' } });

    expect(v.entreprise_complements).toBe('Parking : gratuit devant le gîte.\nAnimaux acceptés.');
    expect(v.entreprise_offre).toBe('Des sites de réservation directe.');
  });

  it('garde « un membre de l’équipe » quand l’interlocuteur est vide : la phrase du rendez-vous en a besoin', () => {
    expect(variablesDeLAppel({ ...contexte, rendezVous: { interlocuteur: ' ', dureeMinutes: 30 } }).rendez_vous).toBe(
      'une visio de 30 minutes avec un membre de l’équipe',
    );
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

  it('donne l’issue seule d’un échange dont le bilan est purgé (durée de conservation)', () => {
    const v = variablesDeLAppel({ ...contexte, historique: [{ le: new Date('2025-09-20T09:00:00Z'), issue: 'Refus', resume: '' }] });

    expect(v.historique_appels).toBe('Le samedi 20 septembre : Refus.');
  });

  it('décrit le rendez-vous : une visio avec l’interlocuteur de l’entreprise', () => {
    expect(variablesDeLAppel(contexte).rendez_vous).toBe('une visio de 30 minutes avec Camille');
  });

  it('donne l’e-mail connu du prospect, ou dit qu’il faut le demander', () => {
    expect(variablesDeLAppel(contexte).prospect_email).toBe('inconnu, à demander');
    expect(variablesDeLAppel({ ...contexte, prospect: { ...contexte.prospect, email: 'julie@exemple.test' } }).prospect_email).toBe('julie@exemple.test');
  });

  it('se contente du nom quand le rôle ou la société manquent', () => {
    const v = variablesDeLAppel({ ...contexte, prospect: { ...contexte.prospect, role: null, societe: null } });

    expect(v.prospect_role).toBe('responsable');
    expect(v.prospect_societe).toBe('son entreprise');
  });
});

describe('cohérence avec le prompt de l’assistante', () => {
  it('fournit chaque variable que le prompt utilise, et aucune de trop', async () => {
    const { readFile } = await import('node:fs/promises');
    const prompt = await readFile(new URL('../../../agent/prompt.md', import.meta.url), 'utf8');
    const utilisees = new Set([...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

    expect([...utilisees].sort()).toEqual([...VARIABLES_DE_L_APPEL].sort());
  });
});
