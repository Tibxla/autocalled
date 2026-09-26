import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error("variable d'environnement manquante : DATABASE_URL");

// En développement, le rechargement à chaud réévalue ce module : on garde une seule connexion.
const globale = globalThis as unknown as { client?: postgres.Sql };
const client = globale.client ?? postgres(url, { max: 5 });
if (process.env.NODE_ENV !== 'production') globale.client = client;

export const db = drizzle(client, { schema, casing: 'snake_case' });
