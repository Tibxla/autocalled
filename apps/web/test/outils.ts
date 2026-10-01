import { sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';
import { db } from '@/db';

/**
 * Chaque test part d'une base vide. Vérifie d'abord, auprès de Postgres lui-même, que la base est bien une base de
 * test.
 */
export async function viderBase(): Promise<void> {
  const [{ nom } = { nom: '' }] = await db.execute<{ nom: string }>(sql`select current_database() as nom`);
  if (!nom.endsWith('_test')) throw new Error(`refus de vider la base « ${nom} » : ce n'est pas une base de test`);
  const tables = await db.execute<{ nom: string }>(
    sql`select table_name as nom from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  if (tables.length === 0) return;
  await db.execute(sql.raw(`truncate ${tables.map((t) => `"${t.nom}"`).join(', ')} restart identity cascade`));
}

/** À appeler en tête d'un fichier de test qui touche la base. */
export function avecBaseDeTest(): void {
  beforeEach(viderBase);
  afterAll(async () => {
    await db.$client.end();
  });
}
