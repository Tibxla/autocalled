import 'server-only';
import { headers } from 'next/headers';
import { estOperateur, identiteAppelant } from './operateur';

/**
 * À appeler en tête de chaque action serveur : une action est joignable par une simple requête
 * POST, le proxy ne suffit pas à la protéger.
 */
export async function exigerOperateur(): Promise<string> {
  const login = identiteAppelant(await headers());
  if (!estOperateur(login) || !login) throw new Error('accès réservé à l’opérateur');
  return login;
}
