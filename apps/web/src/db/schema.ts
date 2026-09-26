import type { Bilan, EntreeCampagne, IssueSysteme, PlageHoraire, StatutCampagne, TourDeParole } from '@autocalled/domain';
import { ISSUES_SYSTEME } from '@autocalled/domain';
import {
  boolean,
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
  dureeRendezVousMinutes: integer().notNull().default(30),
  /** La personne avec qui le prospect aura sa visio (« Camille »). */
  interlocuteur: text().notNull().default(''),
  plagesRendezVous: jsonb().$type<PlageHoraire[]>().notNull().default([]),
  delaiMinimumHeures: integer().notNull().default(24),
  horizonJours: integer().notNull().default(14),
  fuseau: text().notNull().default('Europe/Paris'),
  creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
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
  },
  (t) => [unique().on(t.scriptId, t.numero)],
);

/** Le texte accepté par une personne qui autorise son numéro ; versionné, jamais modifié. */
export const textesConsentement = pgTable('textes_consentement', {
  version: integer().primaryKey(),
  texte: text().notNull(),
  creeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const imports = pgTable('imports', {
  id: uuid().primaryKey().defaultRandom(),
  entrepriseId: uuid()
    .notNull()
    .references(() => entreprises.id, { onDelete: 'cascade' }),
  texteConsentementVersion: integer()
    .notNull()
    .references(() => textesConsentement.version),
  nombreFiches: integer().notNull(),
  importeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const consentements = pgTable('consentements', {
  id: uuid().primaryKey().defaultRandom(),
  numero: text().notNull(),
  texteVersion: integer()
    .notNull()
    .references(() => textesConsentement.version),
  importId: uuid()
    .notNull()
    .references(() => imports.id),
  accordeLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  revoqueLe: timestamp({ withTimezone: true }),
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
  },
  (t) => [primaryKey({ columns: [t.entrepriseId, t.id] })],
);

export const ligne = pgEnum('ligne', ['navigateur', 'simulation', 'bluetooth', 'twilio']);

/**
 * Cycle d'un appel : `en-cours` pendant la conversation, `traitement` le temps de rapatrier la
 * transcription et l'audio puis d'analyser, `termine` avec son bilan, `echec` si l'analyse a échoué.
 */
export const statutAppel = pgEnum('statut_appel', ['en-cours', 'traitement', 'termine', 'echec']);

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
  /** Le numéro composé, tel qu'autorisé au moment de l'appel. */
  numero: text().notNull(),
  conversationId: text().unique(),
  /** Version de l'agent ElevenLabs qui a parlé : les bilans comparent aussi cela. */
  versionAgent: text(),
  statut: statutAppel().notNull().default('en-cours'),
  debutLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finLe: timestamp({ withTimezone: true }),
  dureeSecondes: integer(),
  transcription: jsonb().$type<TourDeParole[]>(),
  /** Chemin relatif de l'enregistrement dans le dossier de données, hors dépôt. */
  audio: text(),
  bilan: jsonb().$type<Bilan>(),
  issue: text(),
  issueSysteme: issueSysteme(),
  versionAnalyseur: text(),
  erreur: text(),
});

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
