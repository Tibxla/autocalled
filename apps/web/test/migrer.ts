import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { urlBaseDeTest } from './base-de-test';

/** Mise en place globale de vitest : la base de test suit les mêmes migrations que la vraie. */
export default async function migrer() {
  const client = postgres(urlBaseDeTest(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  } finally {
    await client.end();
  }
}
