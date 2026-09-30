import { readFileSync } from 'node:fs';
import { VARIABLES_DE_L_APPEL } from '@autocalled/domain';
import { describe, expect, it } from 'vitest';
import { REGLAGES_MODIFIABLES } from './configuration-assistante';
import {
  CE_QUI_EST_MODIFIABLE,
  cloture,
  clesSensibles,
  configurationATelecharger,
  connaissancesDe,
  enTeteTelechargement,
  etatsDesVariables,
  markdownDeLaVue,
  nomDeFichier,
  outilsDe,
  QUAND_ELLE_S_EN_SERT,
  REGLAGES_DE_LA_LISTE,
  resoudre,
  resumeConfiguration,
  segmenter,
  texteDesSegments,
  variablesInconnues,
  type VueResolue,
} from './vue-assistante';

// Le vrai fichier du dépôt, lu seulement : ses valeurs d'exemple sont fictives.
const brute = readFileSync(new URL('../../../../agent/mina.config.json', import.meta.url), 'utf8');
const configuration = JSON.parse(brute) as Record<string, unknown>;

describe('mise en évidence des variables', () => {
  it('découpe le texte en morceaux et en variables, dans l’ordre', () => {
    expect(segmenter('Tu es {{assistante_nom}}, de {{entreprise_nom}}.')).toEqual([
      { type: 'texte', texte: 'Tu es ' },
      { type: 'variable', nom: 'assistante_nom' },
      { type: 'texte', texte: ', de ' },
      { type: 'variable', nom: 'entreprise_nom' },
      { type: 'texte', texte: '.' },
    ]);
    expect(segmenter('{{a}}{{b}}')).toEqual([
      { type: 'variable', nom: 'a' },
      { type: 'variable', nom: 'b' },
    ]);
    expect(segmenter('Sans variable, { simple } ni {{ espacee }}.')).toEqual([{ type: 'texte', texte: 'Sans variable, { simple } ni {{ espacee }}.' }]);
  });

  it('signale les variables que l’application n’envoie pas, une fois chacune', () => {
    expect(variablesInconnues('{{prospect_nom}} {{inventee}} {{inventee}} {{autre}}', VARIABLES_DE_L_APPEL)).toEqual(['inventee', 'autre']);
  });
});

describe('prompt résolu', () => {
  const variables = { assistante_nom: 'Mina', entreprise_offre: 'à présenter simplement.', prospect_nom: '', prospect_role: 'responsable' };

  it('distingue la valeur, le texte par défaut, le vide et la fiche du prospect', () => {
    expect(etatsDesVariables({ variables, parDefaut: ['entreprise_offre'], dependDuProspect: ['prospect_role'], sansProspect: false })).toEqual({
      assistante_nom: 'valeur',
      entreprise_offre: 'par-defaut',
      prospect_nom: 'vide',
      prospect_role: 'valeur',
    });
    expect(etatsDesVariables({ variables, parDefaut: [], dependDuProspect: ['prospect_nom', 'prospect_role'], sansProspect: true })).toMatchObject({
      prospect_nom: 'selon-la-fiche',
      prospect_role: 'selon-la-fiche',
    });
  });

  it('remplace chaque variable, marque celles sans valeur et laisse une inconnue telle quelle', () => {
    const etats = { assistante_nom: 'valeur', entreprise_offre: 'par-defaut', prospect_nom: 'vide', prospect_role: 'selon-la-fiche' } as const;
    const segments = resoudre('{{assistante_nom}} : {{entreprise_offre}} / {{prospect_nom}} / {{prospect_role}} / {{inventee}}', variables, etats);
    expect(texteDesSegments(segments)).toBe(
      'Mina : à présenter simplement. / [non renseigné, non transmis] / [{{prospect_role}} : selon la fiche du prospect] / {{inventee}}',
    );
    expect(segments.find((s) => s.type === 'inconnue')).toEqual({ type: 'inconnue', nom: 'inventee', texte: '{{inventee}}' });
  });
});

describe('configuration ElevenLabs', () => {
  it('liste chaque outil une seule fois, avec quand elle s’en sert et qui l’exécute', () => {
    const outils = outilsDe(configuration);
    const noms = outils.map((o) => o.nom);
    expect(new Set(noms).size).toBe(noms.length);
    expect(noms).toEqual(expect.arrayContaining(['proposer_creneaux', 'reserver_creneau', 'etape_script', 'end_call', 'voicemail_detection']));
    // Un outil ajouté à agent/ sans son « quand » ferait mentir la page.
    for (const o of outils) expect(QUAND_ELLE_S_EN_SERT[o.nom], o.nom).toBeTruthy();
    expect(outils.find((o) => o.nom === 'proposer_creneaux')?.executePar).toBe('l’application, par le pont');
    expect(outils.find((o) => o.nom === 'end_call')?.executePar).toBe('ElevenLabs');
    expect(outils.find((o) => o.nom === 'reserver_creneau')?.parametres).toEqual([
      expect.objectContaining({ nom: 'debut', type: 'string', requis: true }),
      expect.objectContaining({ nom: 'email', requis: false }),
      expect.objectContaining({ nom: 'adresse_confirmee', type: 'boolean', requis: false }),
    ]);
  });

  it('ne charge aucune base de connaissances, et la repérerait si elle apparaissait', () => {
    expect(connaissancesDe(configuration)).toEqual([]);
    const avec = { conversation_config: { agent: { prompt: { knowledge_base: [{ id: 'doc', name: 'tarifs.pdf' }], rag: { enabled: false } } } } };
    expect(connaissancesDe(avec).map((c) => c.chemin)).toEqual(['conversation_config.agent.prompt.knowledge_base']);
  });

  it('sert mina.config.json tel quel faute de secret, et masquerait un secret', () => {
    expect(clesSensibles(configuration)).toEqual([]);
    expect(configurationATelecharger(brute, configuration)).toEqual({ texte: brute, masques: [] });
    const avec = { name: 'Mina', webhook: { api_key: 'cle-fictive', token_count: 3 } };
    const { texte, masques } = configurationATelecharger(JSON.stringify(avec), avec);
    expect(masques).toEqual(['webhook.api_key']);
    expect(JSON.parse(texte)).toEqual({ name: 'Mina', webhook: { api_key: '(masqué)', token_count: 3 } });
  });

  it('résume la configuration en français', () => {
    const lignes = new Map(resumeConfiguration(configuration).flatMap((g) => g.lignes.map((l) => [l.intitule, l.valeur] as const)));
    expect(lignes.get('Langue')).toBe('français (fr)');
    expect(lignes.get('Température')).toBe('0,7');
    expect(lignes.get('Durée maximale')).toBe('300 s (5 min)');
    expect(lignes.get('Premier message ElevenLabs')).toBe('vide, volontairement');
    expect(lignes.get('Surcharges permises')).toContain('premier message');
  });

  it('annonce exactement les réglages que le MCP sait écrire', () => {
    expect(REGLAGES_DE_LA_LISTE.map((r) => r.cle)).toEqual(REGLAGES_MODIFIABLES.map((r) => r.cle));
    expect(CE_QUI_EST_MODIFIABLE.filter((e) => !e.modifiable).every((e) => e.claudeCode.length === 0)).toBe(true);
  });
});

describe('téléchargements', () => {
  it('donne des noms de fichier propres et un en-tête qui les encode', () => {
    expect(nomDeFichier(['Mína', 'vue', 'Gîte des Aravis', 'v3', 'sans prospect', '2026-09-30'], 'md')).toBe('mina-vue-gite-des-aravis-v3-sans-prospect-2026-09-30.md');
    expect(nomDeFichier([''], 'md')).toBe('assistante.md');
    expect(enTeteTelechargement('mina-prompt.md')).toBe(`attachment; filename="mina-prompt.md"; filename*=UTF-8''mina-prompt.md`);
    expect(enTeteTelechargement('é"x.md')).toBe(`attachment; filename="__x.md"; filename*=UTF-8''%C3%A9%22x.md`);
  });

  it('clôt un bloc de code par plus d’accents graves que le texte n’en contient', () => {
    expect(cloture('rien')).toBe('```');
    expect(cloture('un ```bloc``` et ````quatre````')).toBe('`````');
  });

  it('assemble un Markdown complet : premier message, prompt résolu, variables, outils', () => {
    const vue: VueResolue = {
      assistante: 'Mina',
      entreprise: 'Atelier fictif',
      version: { script: 'Accroche courte', numero: 2 },
      prospect: null,
      calculeLe: new Date('2026-09-30T08:00:00Z'),
      modelePremierMessage: 'Allô, ici {{assistante_nom}} ?',
      premierMessage: 'Allô, ici Mina ?',
      prompt: '# Personnalité\n\nTu es {{assistante_nom}}. Tu appelles {{prospect_nom}}.\n\n```\nbloc\n```\n',
      variables: { assistante_nom: 'Mina', prospect_nom: '', entreprise_offre: 'à présenter simplement.' },
      etats: { assistante_nom: 'valeur', prospect_nom: 'selon-la-fiche', entreprise_offre: 'par-defaut' },
      motsCles: ['Atelier fictif'],
      outils: outilsDe(configuration).filter((o) => o.nom === 'etape_script'),
      connaissances: [],
    };
    const md = markdownDeLaVue(vue);
    expect(md).toContain('# Ce que voit Mina');
    expect(md).toContain('- Version du script : Accroche courte v2');
    expect(md).toContain('- Prospect : aucun prospect choisi');
    expect(md).toContain('- Tel que transmis : « Allô, ici Mina ? »');
    // Le prompt contient une clôture de trois accents graves : le sien en prend quatre.
    expect(md).toContain('````markdown\n# Personnalité\n\nTu es Mina. Tu appelles [{{prospect_nom}} : selon la fiche du prospect].\n\n```\nbloc\n```\n````');
    expect(md).toContain('#### Offre (`entreprise_offre`)\n\n*non renseigné : texte par défaut transmis*\n\n```text\nà présenter simplement.\n```');
    expect(md).toContain('#### Nom (`prospect_nom`)\n\n*aucun prospect choisi : selon la fiche du prospect*\n\n####');
    expect(md).toContain('### etape_script');
    expect(md).toContain('- Quand elle s’en sert : À chaque passage');
    expect(md).toContain('Aucun fichier de base de connaissances');
  });
});
