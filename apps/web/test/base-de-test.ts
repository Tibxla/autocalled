import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * URL de la base des tests : `DATABASE_URL_TEST` si elle est posée, sinon la base `autocalled_test` du même
 * Postgres que `.env` (compose.yaml). Les tests vident les tables entre deux cas : tout nom de base qui ne
 * finit pas par `_test` est refusé, pour ne jamais toucher la vraie.
 */
export function urlBaseDeTest(): string {
  let brute = process.env.DATABASE_URL_TEST;
  if (!brute) {
    const env = parseEnv(readFileSync(new URL('../../../.env', import.meta.url), 'utf8'));
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL absente de .env : impossible de trouver le Postgres des tests');
    const url = new URL(env.DATABASE_URL);
    url.pathname = '/autocalled_test';
    brute = url.toString();
  }
  if (!new URL(brute).pathname.endsWith('_test')) throw new Error('la base des tests doit avoir un nom qui finit par _test');
  return brute;
}
