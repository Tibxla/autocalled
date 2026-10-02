import type { VARIABLES_DE_L_APPEL } from '@autocalled/domain';
import { slugifier } from './slug';

/**
 * Logique pure de la page Assistante : mise en évidence des `{{variables}}`, prompt résolu, résumé lisible de
 * `agent/mina.config.json`, liste des outils, ce qui est modifiable, et le Markdown « ce que voit l'assistante ».
 * Aucune dépendance serveur : la page, ses routes de téléchargement et l'éditeur du prompt la partagent.
 */

type Json = Record<string, unknown>;

/* ------------------------------------------------------------------ variables */

/** Même motif que la validation du prompt (packages/agent/src/prompt.ts). */
const MOTIF_VARIABLE = /\{\{(\w+)\}\}/g;

export type Segment = { type: 'texte'; texte: string } | { type: 'variable'; nom: string };

/** Découpe un texte en morceaux de texte et en `{{variables}}`, dans l'ordre. */
export function segmenter(texte: string): Segment[] {
  const segments: Segment[] = [];
  let position = 0;
  for (const m of texte.matchAll(MOTIF_VARIABLE)) {
    const debut = m.index ?? 0;
    if (debut > position) segments.push({ type: 'texte', texte: texte.slice(position, debut) });
    segments.push({ type: 'variable', nom: m[1] as string });
    position = debut + m[0].length;
  }
  if (position < texte.length) segments.push({ type: 'texte', texte: texte.slice(position) });
  return segments;
}

/** Les `{{variables}}` du texte que l'application n'envoie pas, sans doublon. */
export function variablesInconnues(texte: string, connues: readonly string[]): string[] {
  const permises = new Set(connues);
  return [...new Set([...texte.matchAll(MOTIF_VARIABLE)].map((m) => m[1] as string))].filter((v) => !permises.has(v));
}

/** Combien de fois chaque variable connue apparaît dans le texte. */
export function occurrencesDesVariables(texte: string, connues: readonly string[]): Map<string, number> {
  const comptes = new Map(connues.map((v) => [v, 0]));
  for (const m of texte.matchAll(MOTIF_VARIABLE)) {
    const nom = m[1] as string;
    if (comptes.has(nom)) comptes.set(nom, (comptes.get(nom) ?? 0) + 1);
  }
  return comptes;
}

/**
 * Ce que vaut une variable dans l'aperçu. `par-defaut` : le champ est vide, l'application transmet son texte par
 * défaut (packages/domain, `variablesDeLAppel`). `vide` : la valeur est vide, rien d'utile n'est transmis.
 * `selon-la-fiche` : aucun prospect choisi, la valeur dépendra de sa fiche.
 */
export type EtatVariable = 'valeur' | 'par-defaut' | 'vide' | 'selon-la-fiche';

export const LIBELLES_ETAT: Record<Exclude<EtatVariable, 'valeur'>, string> = {
  'par-defaut': 'non renseigné : texte par défaut transmis',
  vide: 'non renseigné, non transmis',
  'selon-la-fiche': 'aucun prospect choisi : selon la fiche du prospect',
};

export function etatsDesVariables(a: {
  variables: Record<string, string>;
  parDefaut: readonly string[];
  dependDuProspect: readonly string[];
  sansProspect: boolean;
}): Record<string, EtatVariable> {
  return Object.fromEntries(
    Object.entries(a.variables).map(([cle, valeur]) => {
      if (a.sansProspect && a.dependDuProspect.includes(cle)) return [cle, 'selon-la-fiche'];
      if (!valeur.trim()) return [cle, 'vide'];
      return [cle, a.parDefaut.includes(cle) ? 'par-defaut' : 'valeur'];
    }),
  );
}

export type SegmentResolu =
  | { type: 'texte'; texte: string }
  | { type: 'variable'; nom: string; etat: EtatVariable; texte: string }
  /** Une `{{variable}}` que l'application n'envoie pas : laissée telle quelle. */
  | { type: 'inconnue'; nom: string; texte: string };

/**
 * Le texte que porte une variable dans le prompt résolu. Vide, elle reste vide, comme dans l'appel réel (le prompt dit
 * qu'une ligne sans rien après ses deux-points n'existe pas) : seul l'écran pose un marqueur (`TexteResolu`). Sans
 * prospect choisi, un marqueur dit que la valeur dépendra de sa fiche.
 */
function texteResolu(nom: string, valeur: string, etat: EtatVariable): string {
  if (etat === 'vide') return '';
  if (etat === 'selon-la-fiche') return `[{{${nom}}} : selon la fiche du prospect]`;
  return valeur;
}

/** Le prompt tel que l'assistante le reçoit : chaque `{{variable}}` remplacée par sa valeur. */
export function resoudre(texte: string, variables: Record<string, string>, etats: Record<string, EtatVariable>): SegmentResolu[] {
  return segmenter(texte).map((s) => {
    if (s.type === 'texte') return s;
    const valeur = variables[s.nom];
    const etat = etats[s.nom];
    if (valeur === undefined || etat === undefined) return { type: 'inconnue', nom: s.nom, texte: `{{${s.nom}}}` };
    return { type: 'variable', nom: s.nom, etat, texte: texteResolu(s.nom, valeur, etat) };
  });
}

export const texteDesSegments = (segments: readonly SegmentResolu[]) => segments.map((s) => s.texte).join('');

/**
 * Libellés lisibles des variables, par groupe : la seule liste, partagée par la page Assistante, son téléchargement et
 * l'aperçu de la fiche d'entreprise. Un test vérifie qu'elle couvre exactement `VARIABLES_DE_L_APPEL`.
 */
export const GROUPES_VARIABLES: { titre: string; cles: [(typeof VARIABLES_DE_L_APPEL)[number], string][] }[] = [
  {
    titre: 'Entreprise',
    cles: [
      ['entreprise_nom', 'Nom'],
      ['entreprise_offre', 'Offre'],
      ['entreprise_cible', 'Pour qui'],
      ['entreprise_arguments', 'Ce qui fait la différence'],
      ['entreprise_prix_consigne', 'Consigne sur le prix'],
      ['entreprise_interdits', 'À ne jamais dire ni promettre'],
      ['entreprise_complements', 'Informations complémentaires'],
      ['rendez_vous', 'Rendez-vous'],
    ],
  },
  {
    titre: 'Script',
    cles: [
      ['script_etapes', 'Étapes'],
      ['objections', 'Objections'],
    ],
  },
  {
    titre: 'Prospect',
    cles: [
      ['prospect_nom', 'Nom'],
      ['prospect_role', 'Rôle'],
      ['prospect_societe', 'Société'],
      ['prospect_contexte', 'Contexte'],
      ['prospect_email', 'E-mail'],
      ['historique_appels', 'Appels précédents'],
    ],
  },
  {
    titre: 'Appel',
    cles: [
      ['assistante_nom', 'Nom de l’assistante'],
      ['situation_appel', 'Qui appelle qui'],
      ['date_du_jour', 'Date du jour'],
    ],
  },
];

/* ------------------------------------------------------------------ configuration */

export function lireChemin(objet: unknown, chemin: string): unknown {
  return chemin.split('.').reduce<unknown>((o, cle) => (o && typeof o === 'object' ? (o as Json)[cle] : undefined), objet);
}

const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const nombre = (v: unknown) => (typeof v === 'number' ? NOMBRE.format(v) : 'non défini');
const texte = (v: unknown) => (typeof v === 'string' && v ? v : 'non défini');
const ouiNon = (v: unknown) => (v === true ? 'oui' : v === false ? 'non' : 'non défini');
const liste = (v: unknown) => (Array.isArray(v) && v.length ? v.map(String).join(' · ') : 'aucun');
const secondes = (v: unknown) => (typeof v === 'number' ? `${NOMBRE.format(v)} s` : 'non défini');

const EMPRESSEMENT: Record<string, string> = { patient: 'patient', normal: 'normal', eager: 'pressé (eager)' };
const LANGUES: Record<string, string> = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien' };
const SURCHARGES: Record<string, string> = {
  'agent.first_message': 'premier message',
  'asr.keywords': 'mots-clés de la reconnaissance vocale',
  'conversation.text_only': 'mode texte seul (simulation)',
  'agent.language': 'langue',
  'agent.prompt.prompt': 'prompt',
  'tts.voice_id': 'voix',
};

function feuillesVraies(objet: unknown, prefixe = ''): string[] {
  if (!objet || typeof objet !== 'object') return objet === true ? [prefixe] : [];
  return Object.entries(objet as Json).flatMap(([cle, v]) => feuillesVraies(v, prefixe ? `${prefixe}.${cle}` : cle));
}

export interface LigneResume {
  intitule: string;
  valeur: string;
  detail?: string;
}

/** `agent/mina.config.json` en français, groupe par groupe. */
export function resumeConfiguration(c: Json): { titre: string; lignes: LigneResume[] }[] {
  const a = (chemin: string) => lireChemin(c, chemin);
  const langue = a('conversation_config.agent.language');
  const duree = a('conversation_config.conversation.max_duration_seconds');
  const surcharges = feuillesVraies(a('platform_settings.overrides.conversation_config_override'));
  const premierMessage = a('conversation_config.agent.first_message');
  return [
    {
      titre: 'Modèle',
      lignes: [
        { intitule: 'Modèle de langage', valeur: texte(a('conversation_config.agent.prompt.llm')) },
        { intitule: 'Température', valeur: nombre(a('conversation_config.agent.prompt.temperature')), detail: 'De 0 (constante) à 1 (variée).' },
        { intitule: 'Langue', valeur: typeof langue === 'string' ? `${LANGUES[langue] ?? langue} (${langue})` : 'non définie' },
      ],
    },
    {
      titre: 'Voix',
      lignes: [
        { intitule: 'Identifiant de voix', valeur: texte(a('conversation_config.tts.voice_id')) },
        { intitule: 'Modèle de voix', valeur: texte(a('conversation_config.tts.model_id')) },
        { intitule: 'Stabilité', valeur: nombre(a('conversation_config.tts.stability')) },
        { intitule: 'Similarité', valeur: nombre(a('conversation_config.tts.similarity_boost')) },
        { intitule: 'Vitesse', valeur: nombre(a('conversation_config.tts.speed')) },
      ],
    },
    {
      titre: 'Tour de parole',
      lignes: [
        { intitule: 'Empressement', valeur: EMPRESSEMENT[String(a('conversation_config.turn.turn_eagerness'))] ?? texte(a('conversation_config.turn.turn_eagerness')) },
        { intitule: 'Silence avant de reprendre la parole', valeur: secondes(a('conversation_config.turn.turn_timeout')) },
        { intitule: 'Tour spéculatif', valeur: ouiNon(a('conversation_config.turn.speculative_turn')) },
        {
          intitule: 'Mots qui ne l’interrompent pas',
          valeur: liste(a('conversation_config.turn.interruption_ignore_terms')),
          ...(a('conversation_config.turn.merge_with_default_ignore_terms') === true ? { detail: 'En plus de la liste par défaut d’ElevenLabs.' } : {}),
        },
      ],
    },
    {
      titre: 'Relances de silence',
      lignes: [
        { intitule: 'Après', valeur: secondes(a('conversation_config.turn.soft_timeout_config.timeout_seconds')), detail: 'De silence pendant qu’elle prépare sa réponse.' },
        { intitule: 'Première relance', valeur: texte(a('conversation_config.turn.soft_timeout_config.message')) },
        { intitule: 'Relances suivantes', valeur: liste(a('conversation_config.turn.soft_timeout_config.additional_soft_timeout_messages')) },
        { intitule: 'Au plus, par réplique', valeur: nombre(a('conversation_config.turn.soft_timeout_config.max_soft_timeouts_per_generation')) },
        { intitule: 'Tirées au hasard', valeur: ouiNon(a('conversation_config.turn.soft_timeout_config.randomize_fillers')) },
        {
          intitule: 'Avant la première réponse du prospect',
          valeur: a('conversation_config.turn.soft_timeout_config.disable_until_first_user_message') === true ? 'aucune relance' : 'relances permises',
        },
      ],
    },
    {
      titre: 'Appel',
      lignes: [
        {
          intitule: 'Durée maximale',
          valeur: typeof duree === 'number' ? `${NOMBRE.format(duree)} s (${NOMBRE.format(duree / 60)} min)` : 'non définie',
          detail: 'Le pont raccroche de lui-même à 360 s.',
        },
        {
          intitule: 'Premier message ElevenLabs',
          valeur: typeof premierMessage === 'string' && premierMessage ? `« ${premierMessage} »` : 'vide, volontairement',
          detail: 'Le premier message vient de la base : l’application le compose et le pont le transmet à chaque appel.',
        },
        { intitule: 'Authentification', valeur: a('platform_settings.auth.enable_auth') === true ? 'exigée' : 'désactivée', detail: 'Seul un appel signé par l’application ouvre une conversation.' },
        { intitule: 'Surcharges permises', valeur: surcharges.length ? surcharges.map((s) => SURCHARGES[s] ?? s).join(' · ') : 'aucune' },
        { intitule: 'Libellé du tableau de bord', valeur: texte(a('name')) },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ outils */

export interface Parametre {
  nom: string;
  type: string;
  requis: boolean;
  description: string;
}

export interface Outil {
  nom: string;
  /** `client` : exécuté par l'application, par le pont ; `system` : géré par ElevenLabs. */
  type: string;
  description: string;
  parametres: Parametre[];
  quand: string | null;
  executePar: string;
  /** L'assistante attend une réponse avant de continuer (null : non précisé). */
  reponseAttendue: boolean | null;
}

/** Quand l'assistante s'en sert, d'après agent/prompt.md et la description de l'outil. */
export const QUAND_ELLE_S_EN_SERT: Record<string, string> = {
  proposer_creneaux:
    'Quand le prospect accepte le principe d’un rendez-vous. Elle propose à l’oral un ou deux des créneaux renvoyés, jamais la liste entière, et n’en invente aucun : sans liste de créneaux, elle demande le jour et le moment qui l’arrangent.',
  reserver_creneau:
    'Quand le prospect a choisi un créneau. Avec une adresse, un premier appel renvoie l’adresse épelée, qu’elle relit lettre par lettre ; après un oui clair, un second appel avec adresse_confirmee à true réserve et envoie l’invitation. Sans adresse, elle réserve directement.',
  etape_script:
    'À chaque passage à une nouvelle étape du plan, en même temps que sa réplique, jamais à sa place. Silencieux : elle n’en parle jamais, il sert à l’écran de l’opérateur.',
  end_call: 'Après un refus ferme (un remerciement, une bonne journée), un rendez-vous convenu ou une fin de conversation naturelle.',
  voicemail_detection: 'Quand elle tombe sur une messagerie ou un répondeur : elle raccroche sans laisser de message.',
};

const EXECUTE_PAR: Record<string, string> = {
  client: 'l’application, par le pont',
  system: 'ElevenLabs',
};

function outilDe(brut: Json): Outil | null {
  const nom = typeof brut.name === 'string' ? brut.name : null;
  if (!nom) return null;
  const type = typeof brut.type === 'string' ? brut.type : 'inconnu';
  const schema = (brut.parameters ?? {}) as { required?: unknown; properties?: unknown };
  const requis = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const proprietes = schema.properties && typeof schema.properties === 'object' ? (schema.properties as Record<string, Json>) : {};
  return {
    nom,
    type,
    description: typeof brut.description === 'string' ? brut.description : '',
    parametres: Object.entries(proprietes).map(([p, def]) => ({
      nom: p,
      type: typeof def.type === 'string' ? def.type : 'inconnu',
      requis: requis.has(p),
      description: typeof def.description === 'string' ? def.description : '',
    })),
    quand: QUAND_ELLE_S_EN_SERT[nom] ?? null,
    executePar: EXECUTE_PAR[type] ?? type,
    reponseAttendue: typeof brut.expects_response === 'boolean' ? brut.expects_response : null,
  };
}

/** Les outils de l'assistante, sans doublon : ceux de `tools`, puis les outils système absents de la liste. */
export function outilsDe(c: Json): Outil[] {
  const outils = (lireChemin(c, 'conversation_config.agent.prompt.tools') as Json[] | undefined) ?? [];
  const integres = Object.values((lireChemin(c, 'conversation_config.agent.prompt.built_in_tools') as Record<string, Json> | undefined) ?? {});
  const vus = new Set<string>();
  const sortie: Outil[] = [];
  for (const brut of [...outils, ...integres]) {
    if (!brut || typeof brut !== 'object') continue;
    const outil = outilDe(brut);
    if (!outil || vus.has(outil.nom)) continue;
    vus.add(outil.nom);
    sortie.push(outil);
  }
  return sortie;
}

/* ------------------------------------------------------------------ connaissances et secrets */

/** Les champs de base de connaissances ou de recherche documentaire déclarés et non vides. */
export function connaissancesDe(c: Json): { chemin: string; valeur: unknown }[] {
  const trouves: { chemin: string; valeur: unknown }[] = [];
  const parcourir = (objet: unknown, prefixe: string) => {
    if (!objet || typeof objet !== 'object' || Array.isArray(objet)) return;
    for (const [cle, valeur] of Object.entries(objet as Json)) {
      const chemin = prefixe ? `${prefixe}.${cle}` : cle;
      if (/knowledge_base|^rag$/i.test(cle)) {
        const vide = valeur == null || (Array.isArray(valeur) && valeur.length === 0) || (typeof valeur === 'object' && !Array.isArray(valeur) && (valeur as Json).enabled === false);
        if (!vide) trouves.push({ chemin, valeur });
      } else {
        parcourir(valeur, chemin);
      }
    }
  };
  parcourir(c, '');
  return trouves;
}

const CLE_SENSIBLE = /api[_-]?key|secret|token|password|mot[_-]?de[_-]?passe|authorization|bearer|signature/i;

/** Les chemins des clés qui ressemblent à un secret et portent un texte non vide. */
export function clesSensibles(objet: unknown, prefixe = ''): string[] {
  if (!objet || typeof objet !== 'object') return [];
  return Object.entries(objet as Json).flatMap(([cle, valeur]) => {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (CLE_SENSIBLE.test(cle) && typeof valeur === 'string' && valeur) return [chemin];
    return clesSensibles(valeur, chemin);
  });
}

function masquer(objet: unknown, chemins: Set<string>, prefixe = ''): unknown {
  if (Array.isArray(objet)) return objet.map((v, i) => masquer(v, chemins, prefixe ? `${prefixe}.${i}` : String(i)));
  if (!objet || typeof objet !== 'object') return objet;
  return Object.fromEntries(
    Object.entries(objet as Json).map(([cle, valeur]) => {
      const chemin = prefixe ? `${prefixe}.${cle}` : cle;
      return [cle, chemins.has(chemin) ? '(masqué)' : masquer(valeur, chemins, chemin)];
    }),
  );
}

/** Le fichier tel quel s'il ne contient aucun secret ; sinon la même configuration, secrets masqués. */
export function configurationATelecharger(brute: string, configuration: Json): { texte: string; masques: string[] } {
  const masques = clesSensibles(configuration);
  if (masques.length === 0) return { texte: brute, masques };
  return { texte: `${JSON.stringify(masquer(configuration, new Set(masques)), null, 2)}\n`, masques };
}

/* ------------------------------------------------------------------ ce qui est modifiable */

/** Les réglages de la liste fermée, dans l'ordre de lib/configuration-assistante.ts (REGLAGES_MODIFIABLES). */
export const REGLAGES_DE_LA_LISTE: readonly { cle: string; libelle: string }[] = [
  { cle: 'llm', libelle: 'modèle de langage' },
  { cle: 'temperature', libelle: 'température' },
  { cle: 'voix.voiceId', libelle: 'voix' },
  { cle: 'voix.modele', libelle: 'modèle de voix' },
  { cle: 'voix.stabilite', libelle: 'stabilité' },
  { cle: 'voix.similarite', libelle: 'similarité' },
  { cle: 'voix.vitesse', libelle: 'vitesse' },
  { cle: 'tour.empressement', libelle: 'empressement' },
  { cle: 'tour.delaiSilenceS', libelle: 'silence avant de reprendre la parole' },
  { cle: 'tour.speculatif', libelle: 'tour spéculatif' },
  { cle: 'tour.motsIgnores', libelle: 'mots qui ne l’interrompent pas' },
  { cle: 'relances.premiere', libelle: 'première relance' },
  { cle: 'relances.suivantes', libelle: 'relances suivantes' },
  { cle: 'relances.delaiS', libelle: 'délai des relances' },
  { cle: 'dureeMaxS', libelle: 'durée maximale' },
  { cle: 'libelleTableauDeBord', libelle: 'libellé du tableau de bord' },
];

export interface ElementModifiable {
  element: string;
  modifiable: boolean;
  /** La section de cette page où il se modifie (null : pas ici). */
  ici: string | null;
  /** Les outils MCP de Claude Code qui le changent (vide : lecture seule). */
  claudeCode: string[];
  /** Ce que fait la modification et quand elle vaut pour les prospects, ou pourquoi c'est en lecture seule. */
  effet: string;
}

/**
 * Ce qui se règle, et par où (décision de l'opérateur du 30/09/2026) : la page Assistante fait ce que font les outils
 * MCP de Claude Code (mcp/assistante.ts), par les mêmes fonctions, sauf le prompt, qui s'écrit par Claude Code. Ce qui
 * change pour un prospect passe par une confirmation, ici comme dans Claude Code.
 */
export const CE_QUI_EST_MODIFIABLE: readonly ElementModifiable[] = [
  {
    element: 'Nom et premier message',
    modifiable: true,
    ici: 'Identité',
    claudeCode: ['modifier_assistante'],
    effet: 'En base : valent dès l’appel suivant, sans poussée, après ta confirmation.',
  },
  {
    element: 'Prompt système',
    modifiable: true,
    ici: null,
    claudeCode: ['modifier_prompt_assistante', 'pousser_assistante'],
    effet: 'Le prompt se modifie par Claude Code (modifier_prompt_assistante), puis se pousse ici ou par Claude Code. Il doit garder toutes les variables et la section « # Règles » ; rien ne change pour les appels avant la poussée.',
  },
  {
    element: 'Réglages de la liste fermée',
    modifiable: true,
    ici: 'Réglages',
    claudeCode: ['modifier_reglages_assistante', 'pousser_assistante'],
    effet: `Écrit agent/mina.config.json : ${REGLAGES_DE_LA_LISTE.map((r) => r.libelle).join(', ')}. Rien ne change avant la poussée.`,
  },
  {
    element: 'Poussée vers ElevenLabs',
    modifiable: true,
    ici: 'Poussée',
    claudeCode: ['pousser_assistante'],
    effet: 'Envoie le prompt et les réglages de agent/ après ta confirmation sur la différence rédigée par le serveur ; ils servent dès le prochain appel. Refusée pendant un appel.',
  },
  {
    element: 'Rapatriement',
    modifiable: true,
    ici: 'Poussée',
    claudeCode: ['rapatrier_assistante'],
    effet: 'Réécrit agent/ d’après ElevenLabs (après une modification dans le tableau de bord), sauf s’il reste des modifications non poussées.',
  },
  {
    element: 'Historique et retour arrière',
    modifiable: true,
    ici: 'Historique',
    claudeCode: ['historique_assistante', 'restaurer_assistante'],
    effet: 'Liste les configurations consignées et réécrit agent/ depuis l’une d’elles ; elle ne sert aux appels qu’après une poussée.',
  },
  {
    element: 'Langue',
    modifiable: false,
    ici: null,
    claudeCode: [],
    effet: 'Par le code, relu, puis pnpm agent push (ADR 0010) : le prompt, les textes de l’application et l’analyse des appels sont en français.',
  },
  {
    element: 'Définitions des outils',
    modifiable: false,
    ici: null,
    claudeCode: [],
    effet: 'Contrat avec le code : le pont n’exécute que proposer_creneaux, reserver_creneau et etape_script, que l’application traite par leur nom et leurs paramètres. Un changement se fait dans le code, relu, puis pnpm agent push.',
  },
  {
    element: 'Surcharges permises',
    modifiable: false,
    ici: null,
    claudeCode: [],
    effet: 'Le pont surcharge le premier message et les mots-clés de la reconnaissance vocale à chaque appel : sans ces permissions, l’ouverture casserait.',
  },
  {
    element: 'Authentification',
    modifiable: false,
    ici: null,
    claudeCode: [],
    effet: 'Garde de sécurité : seul un appel signé par l’application ouvre une conversation avec l’assistante.',
  },
  {
    element: 'Valeurs d’exemple des variables',
    modifiable: false,
    ici: null,
    claudeCode: [],
    effet: 'Servent aux essais dans le tableau de bord ElevenLabs ; chaque vrai appel envoie ses propres valeurs. Par pnpm agent push.',
  },
];

/** D'où vient une configuration consignée (versions_assistante), pour la page Assistante et Réglages. */
export const ORIGINE_VERSION: Record<string, string> = {
  mcp: 'poussée par Claude Code',
  interface: 'poussée depuis l’interface',
  cli: 'poussée en ligne de commande',
  distante: 'rapatriée du tableau de bord ElevenLabs',
};

/* ------------------------------------------------------------------ téléchargements */

/** « 2026-09-30 », jour de Paris. */
export function jourIso(date: Date): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Un nom de fichier propre : parties réduites en slug, jointes par des tirets. */
export function nomDeFichier(parties: readonly string[], extension: string): string {
  const corps = parties.map(slugifier).filter(Boolean).join('-') || 'assistante';
  return `${corps}.${extension}`;
}

/** L'en-tête Content-Disposition d'un téléchargement, nom encodé pour les caractères hors ASCII. */
export function enTeteTelechargement(nom: string): string {
  const ascii = nom.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

/** Une clôture de code plus longue que toute suite d'accents graves du texte. */
export function cloture(contenu: string): string {
  const plusLongue = Math.max(0, ...[...contenu.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, plusLongue + 1));
}

function blocDeCode(contenu: string, langage = ''): string {
  const c = cloture(contenu);
  return `${c}${langage}\n${contenu.replace(/\n$/, '')}\n${c}`;
}

export interface VueResolue {
  assistante: string;
  entreprise: string;
  version: { script: string; numero: number } | null;
  prospect: string | null;
  calculeLe: Date;
  /** Le modèle du premier message, tel qu'enregistré. */
  modelePremierMessage: string;
  /** Le premier message composé, tel que le pont le transmet. */
  premierMessage: string;
  prompt: string;
  variables: Record<string, string>;
  etats: Record<string, EtatVariable>;
  motsCles: string[];
  outils: Outil[];
  /** Les champs de connaissances déclarés dans la configuration (`connaissancesDe`). */
  connaissances: { chemin: string }[];
}

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Le Markdown complet de « ce que voit l'assistante » : premier message, prompt résolu, variables, outils. */
export function markdownDeLaVue(v: VueResolue): string {
  const version = v.version ? `${v.version.script} v${v.version.numero}` : 'aucun script (étape par défaut)';
  const lignes: string[] = [
    `# Ce que voit ${v.assistante}`,
    '',
    `- Entreprise : ${v.entreprise}`,
    `- Version du script : ${version}`,
    `- Prospect : ${v.prospect ?? 'aucun prospect choisi (les variables du prospect dépendront de sa fiche)'}`,
    `- Calculé le ${DATE_LONGUE.format(v.calculeLe)}, comme au début d’un vrai appel.`,
    '',
    '## Premier message',
    '',
    'Dit quand le prospect se tait au décroché.',
    '',
    `- Modèle enregistré : « ${v.modelePremierMessage} »`,
    `- Tel que transmis : « ${v.premierMessage} »`,
    '',
    '## Prompt résolu',
    '',
    blocDeCode(texteDesSegments(resoudre(v.prompt, v.variables, v.etats)), 'markdown'),
    '',
    '## Variables',
    '',
  ];
  for (const groupe of GROUPES_VARIABLES) {
    lignes.push(`### ${groupe.titre}`, '');
    for (const [cle, libelle] of groupe.cles) {
      const etat = v.etats[cle] ?? 'valeur';
      const valeur = v.variables[cle] ?? '';
      lignes.push(`#### ${libelle} (\`${cle}\`)`, '');
      if (etat !== 'valeur') lignes.push(`*${LIBELLES_ETAT[etat]}*`, '');
      if (etat !== 'selon-la-fiche' && etat !== 'vide') lignes.push(blocDeCode(valeur, 'text'), '');
    }
  }
  lignes.push('### Mots-clés de la reconnaissance vocale', '', v.motsCles.length ? v.motsCles.join(' · ') : 'aucun', '', '## Outils', '');
  for (const o of v.outils) {
    lignes.push(`### ${o.nom}`, '', `- Type : ${o.type}, exécuté par ${o.executePar}`, `- Description : ${o.description || 'aucune'}`);
    if (o.quand) lignes.push(`- Quand elle s’en sert : ${o.quand}`);
    if (o.parametres.length) {
      lignes.push('- Paramètres :');
      for (const p of o.parametres) lignes.push(`  - \`${p.nom}\` (${p.type}${p.requis ? ', requis' : ''}) : ${p.description || 'sans description'}`);
    }
    lignes.push('');
  }
  lignes.push(
    '## Connaissances',
    '',
    v.connaissances.length
      ? `Champs de connaissances déclarés dans la configuration : ${v.connaissances.map((c) => `\`${c.chemin}\``).join(', ')}.`
      : 'Aucun fichier de base de connaissances : tout ce qu’elle sait lui arrive par ce prompt et ses variables.',
    '',
  );
  return lignes.join('\n');
}
