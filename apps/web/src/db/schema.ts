import type { IssueSysteme, PlageHoraire } from '@autocalled/domain';
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
    contexte: text().notNull(),
    importId: uuid().references(() => imports.id),
    majLe: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entrepriseId, t.id] })],
);
