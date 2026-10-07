import type { BilanEnregistre, EntreeCampagne, IssueSysteme, PlageHoraire, StatutCampagne, TourDeParole } from '@autocalled/domain';
import { ISSUES_SYSTEME } from '@autocalled/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Qui a écrit en dernier une donnée que l'opérateur édite aussi : l'interface ou le serveur MCP (Claude Code).
 * Null pour les lignes antérieures à la colonne, dont l'origine n'est pas connue.
 */
export type Origine = 'interface' | 'mcp';

export const issueSysteme = pgEnum('issue_systeme', ISSUES_SYSTEME as unknown as [IssueSysteme, ...IssueSysteme[]]);

export const entreprises = pgTable('entreprises', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  nom: text().notNull(),
  offre: text().notNull().default(''),
  cible: text().notNull().default(''),
  arguments: text().notNull().default(''),
  prixConsigne: text().notNull().default(''),
  interdits: text().notNull().default(''),
  /** Informations complémentaires : texte libre que l'assistante n'emploie que si la conversation y mène. */
  complements: text().notNull().default(''),
  dureeRendezVousMinutes: integer().notNull().default(30),
  /** La personne avec qui le prospect aura sa visio (« Camille »). */
  interlocuteur: text().notNull().default(''),
  plagesRendezVous: jsonb().$type<PlageHoraire[]>().notNull().default([]),
  delaiMinimumHeures: integer().notNull().default(24),
  horizonJours: integer().notNull().default(14),
  fuseau: text().notNull().default('Europe/Paris'),
  creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** Dernier enregistrement de la fiche : un formulaire ouvert avant refuse d'écraser ce qu'il n'a pas vu. */
  modifieLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  modifiePar: text().$type<Origine>(),
});

/** Une objection garde son identité d'un appel à l'autre : on l'archive, on ne la supprime pas. */
export const objections = pgTable(
  'objections',
  {
    id: uuid().primaryKey().defaultRandom(),
    entrepriseId: uuid()
      .notNull()
      .references(() => entreprises.id, { onDelete: 'cascade' }),
    libelle: text().notNull(),
    creuser: text().notNull().default(''),
    reformuler: text().notNull().default(''),
    argumenter: text().notNull().default(''),
    controler: text().notNull().default(''),
    ordre: integer().notNull().default(0),
    archivee: boolean().notNull().default(false),
    /** Dernière écriture du texte ou de l'archivage (pas de l'ordre) : garde contre les modifications concurrentes. */
    modifieLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
    modifiePar: text().$type<Origine>(),
  },
);

export const issuesPersonnalisees = pgTable('issues_personnalisees', {
  id: uuid().primaryKey().defaultRandom(),
  entrepriseId: uuid()
    .notNull()
    .references(() => entreprises.id, { onDelete: 'cascade' }),
  libelle: text().notNull(),
  issueSysteme: issueSysteme().notNull(),
  archivee: boolean().notNull().default(false),
});

export const scripts = pgTable('scripts', {
  id: uuid().primaryKey().defaultRandom(),
  entrepriseId: uuid()
    .notNull()
    .references(() => entreprises.id, { onDelete: 'cascade' }),
  nom: text().notNull(),
  /** Un script archivé sort des choix de lancement ; ses versions et ses appels restent. */
  archive: boolean().notNull().default(false),
  creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export interface Etape {
  intention: string;
  exemples: string[];
}

/** Figée à sa création : modifier un script, c'est créer la version suivante. */
export const versionsScript = pgTable(
  'versions_script',
  {
    id: uuid().primaryKey().defaultRandom(),
    scriptId: uuid()
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    numero: integer().notNull(),
    etapes: jsonb().$type<Etape[]>().notNull(),
    creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
    creePar: text().$type<Origine>(),
  },
  (t) => [unique().on(t.scriptId, t.numero)],
);

/** Un import de fiches prospect : les prospects qu'il a créés ou mis à jour y renvoient. */
export const imports = pgTable('imports', {
  id: uuid().primaryKey().defaultRandom(),
  entrepriseId: uuid()
    .notNull()
    .references(() => entreprises.id, { onDelete: 'cascade' }),
  nombreFiches: integer().notNull(),
  importeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** L'identité d'un prospect est le nom de sa fiche, unique dans son entreprise. */
export const prospects = pgTable(
  'prospects',
  {
    entrepriseId: uuid()
      .notNull()
      .references(() => entreprises.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    nom: text().notNull(),
    societe: text(),
    role: text(),
    telephone: text().notNull(),
    email: text(),
    contexte: text().notNull(),
    importId: uuid().references(() => imports.id),
    majLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * Archivé (ADR 0013) : hors des listes par défaut et des choix de campagne, jamais appelé ni ajouté à une campagne
     * tant qu'il l'est ; ses appels et ses bilans restent. Null : actif. Un réimport de la
     * fiche ne le réactive pas.
     */
    archiveLe: timestamp({ withTimezone: true }),
    archivePar: text().$type<Origine>(),
  },
  (t) => [primaryKey({ columns: [t.entrepriseId, t.id] })],
);

export const ligne = pgEnum('ligne', ['navigateur', 'simulation', 'bluetooth', 'twilio']);

/**
 * Cycle d'un appel : `en-cours` pendant la conversation, `traitement` le temps de rapatrier la
 * transcription et l'audio puis d'analyser, `termine` avec son bilan, `echec` si l'analyse a échoué.
 */
export const statutAppel = pgEnum('statut_appel', ['en-cours', 'traitement', 'termine', 'echec']);

/** Qui a appelé : l'assistante (`sortant`), ou un prospect qui rappelle le téléphone passerelle (`entrant`, ADR 0018). */
export const sensAppel = pgEnum('sens_appel', ['sortant', 'entrant']);

export const campagnes = pgTable('campagnes', {
  id: uuid().primaryKey().defaultRandom(),
  entrepriseId: uuid()
    .notNull()
    .references(() => entreprises.id, { onDelete: 'cascade' }),
  versionScriptId: uuid()
    .notNull()
    .references(() => versionsScript.id),
  ligne: ligne().notNull(),
  statut: text().$type<StatutCampagne>().notNull(),
  /** Les entrées du domaine (`EntreeCampagne`), transitions faites par @autocalled/domain. */
  entrees: jsonb().$type<EntreeCampagne[]>().notNull(),
  creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const appels = pgTable('appels', {
  id: uuid().primaryKey().defaultRandom(),
  entrepriseId: uuid()
    .notNull()
    .references(() => entreprises.id, { onDelete: 'cascade' }),
  prospectId: text().notNull(),
  versionScriptId: uuid()
    .notNull()
    .references(() => versionsScript.id),
  campagneId: uuid().references(() => campagnes.id, { onDelete: 'set null' }),
  ligne: ligne().notNull(),
  /** Un appel entrant n'a pas de campagne et ne compte pas au plafond du pont. */
  sens: sensAppel().notNull().default('sortant'),
  /** Le numéro composé, tel que vérifié au moment de l'appel ; pour un appel entrant, celui de l'appelant. */
  numero: text().notNull(),
  conversationId: text().unique(),
  /** Version de l'agent ElevenLabs qui a parlé : les bilans comparent aussi cela. */
  versionAgent: text(),
  /**
   * Le nom sous lequel l'assistante s'est présentée, figé au lancement : transcriptions et bilans gardent le nom
   * de leur époque après un renommage. Null seulement pour une ligne écrite sans lui ; on lit alors le nom actuel.
   */
  assistanteNom: text(),
  statut: statutAppel().notNull().default('en-cours'),
  debutLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finLe: timestamp({ withTimezone: true }),
  /** Dernier passage en `traitement` (fin d'appel ou relance) : l'âge d'une analyse se mesure de là, pas de `finLe`. */
  traitementLe: timestamp({ withTimezone: true }),
  dureeSecondes: integer(),
  transcription: jsonb().$type<TourDeParole[]>(),
  /** Chemin relatif de l'enregistrement dans le dossier de données, hors dépôt. */
  audio: text(),
  /** Le bilan entier, ou ce qu'il en reste après la durée de conservation (`purge: true`, ADR 0014). */
  bilan: jsonb().$type<BilanEnregistre>(),
  issue: text(),
  issueSysteme: issueSysteme(),
  /**
   * L'instant du rappel convenu, tiré du bilan (`bilan.rappelLe`, heure de Paris) pour trier et filtrer les
   * rappels en base ; null sans rappel daté. Réécrit à chaque analyse.
   */
  rappelLe: timestamp({ withTimezone: true }),
  versionAnalyseur: text(),
  erreur: text(),
  /**
   * Passé la durée de conservation (ADR 0014, `DUREE_CONSERVATION_MOIS`) : enregistrements, transcription, texte libre
   * du bilan et de l'erreur effacés ; issue, étape, objections, durée, dates, ligne et versions restent. Null : entier.
   */
  purgeLe: timestamp({ withTimezone: true }),
}, (t) => [index('appels_rappel_le_idx').on(t.rappelLe).where(sql`${t.rappelLe} is not null`)]);

/** La connexion Google Agenda de l'opérateur (une seule). Le jeton de rafraîchissement est chiffré. */
export const connexionGoogle = pgTable('connexion_google', {
  id: integer().primaryKey().default(1),
  email: text(),
  jetonChiffre: text().notNull(),
  /** Le calendrier « Autocalled » créé par l'application, où vont les rendez-vous. */
  calendrierId: text().notNull(),
  connecteLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const rendezVous = pgTable('rendez_vous', {
  id: uuid().primaryKey().defaultRandom(),
  appelId: uuid()
    .notNull()
    .references(() => appels.id, { onDelete: 'cascade' }),
  debut: timestamp({ withTimezone: true }).notNull(),
  fin: timestamp({ withTimezone: true }).notNull(),
  /** Nul tant que l'événement n'est pas créé dans Google Agenda (la création se fait après l'appel). */
  evenementId: text(),
  /** Le calendrier Google où l'événement a été créé. */
  calendrier: text(),
  /** Adresse confirmée par le prospect : Google lui envoie l'invitation. */
  email: text(),
  lienVisio: text(),
  statut: text().$type<'a-creer' | 'cree' | 'echec'>().notNull().default('a-creer'),
  erreur: text(),
  creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Copie des plages occupées de l'agenda, relue avant les appels : pendant un appel, Mina propose des
 * créneaux sans attendre Google. Une seule ligne.
 */
export const disponibilites = pgTable('disponibilites', {
  id: integer().primaryKey().default(1),
  source: text().$type<'mcp' | 'api'>().notNull(),
  occupations: jsonb().$type<{ debut: string; fin: string }[]>().notNull(),
  fenetreDebut: timestamp({ withTimezone: true }).notNull(),
  fenetreFin: timestamp({ withTimezone: true }).notNull(),
  synchroniseLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  erreur: text(),
});

/**
 * Le journal des gestes (ADR 0016) : chaque appel d'outil du serveur MCP (ADR 0009), lectures comprises, on sait ce
 * que Claude a lu (une transcription, par exemple) avant d'agir ; et chaque geste d'écriture de la page Assistante.
 * La table garde son nom d'origine, `journal_mcp` : `origine` dit qui a agi.
 */
export const journalMcp = pgTable('journal_mcp', {
  id: uuid().primaryKey().defaultRandom(),
  le: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** `mcp` : Claude Code, en session locale ; `interface` : l'opérateur, sur la page Assistante. */
  origine: text().$type<Origine>().notNull().default('mcp'),
  /** L'outil du MCP, ou le geste de la page sous le nom de l'outil qui fait la même chose (`pousser_assistante`…). */
  outil: text().notNull(),
  /** Les arguments reçus, les champs volumineux résumés (une fiche importée n'y est pas recopiée). */
  arguments: jsonb().$type<Record<string, unknown>>().notNull(),
  resultat: text().$type<'ok' | 'refus' | 'erreur' | 'confirmation-demandee'>().notNull(),
  message: text(),
  /** Pour les gestes confirmés par l'opérateur : ce qu'il a répondu, ou `indisponible` sans élicitation. */
  confirmation: text().$type<'acceptee' | 'refusee' | 'indisponible' | 'sans-question'>(),
});

/**
 * Ce que l'application envoie à l'assistante avec chaque appel, sans poussée vers ElevenLabs : son nom (variable
 * `assistante_nom`) et son premier message, la phrase dite quand le prospect se tait au décroché. Une seule ligne ;
 * absente, les valeurs par défaut valent (lib/assistante.ts).
 */
export const assistante = pgTable(
  'assistante',
  {
    id: integer().primaryKey().default(1),
    nom: text().notNull().default('Mina'),
    premierMessage: text().notNull().default('Allô ?'),
    modifieLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
    modifiePar: text().$type<Origine>(),
  },
  (t) => [check('assistante_une_seule_ligne', sql`${t.id} = 1`)],
);

/**
 * D'où vient un instantané de la configuration ElevenLabs : poussée par le MCP, par l'interface (page Assistante) ou
 * en ligne de commande, ou rapatriée du tableau de bord. Colonne texte : une origine de plus ne demande pas de migration.
 */
export type OrigineVersionAssistante = 'mcp' | 'interface' | 'cli' | 'distante';

/** Réglages locaux des appels, relus au décroché et à chaque réveil. */
export const reglagesAutomatisation = pgTable('reglages_automatisation', {
  cle: text().primaryKey(),
  valeur: jsonb().$type<Record<string, unknown>>().notNull(),
  modifieLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Instantanés de la configuration ElevenLabs de l'assistante (champs gérés par `agent/`), consignés à chaque poussée
 * ou rapatriement par le MCP ou l'interface. `appels.version_agent` y renvoie : on sait avec quel prompt un appel a été passé.
 */
export const versionsAssistante = pgTable('versions_assistante', {
  id: uuid().primaryKey().defaultRandom(),
  /** Le `version_id` d'ElevenLabs (agtvrsn_…). */
  versionId: text().notNull().unique(),
  empreinte: text().notNull(),
  prompt: text().notNull(),
  /** Les champs gérés, sans le prompt. */
  configuration: jsonb().$type<Record<string, unknown>>().notNull(),
  origine: text().$type<OrigineVersionAssistante>().notNull(),
  consigneLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Liste d'opposition (ADR 0013) : l'empreinte irréversible (HMAC-SHA256, sel `SEL_OPPOSITION` de l'installation) du
 * numéro de chaque personne effacée. Ses données partent avec elle ; l'interdiction de la rappeler reste :
 * `appelabiliteDe` et l'import consultent cette table. Aucune donnée personnelle en clair. La ligne `temoin` porte
 * l'empreinte d'une constante : si le sel change ou manque, elle ne se retrouve plus et plus rien n'est composé.
 */
export const oppositions = pgTable('oppositions', {
  empreinte: text().primaryKey(),
  temoin: boolean().notNull().default(false),
  le: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** Par où l'effacement a été demandé ; null pour le témoin. */
  par: text().$type<Origine>(),
  /** Ce que l'effacement a supprimé, en comptes seulement (appels, fichiers, rendez-vous…). */
  bilan: jsonb().$type<Record<string, number>>(),
});
