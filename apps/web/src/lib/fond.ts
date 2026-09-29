import 'server-only';
import { after } from 'next/server';

/**
 * Tâche de fond qui ne doit pas retarder la réponse. Dans une requête Next, `after` la lance une fois la
 * réponse partie. Hors requête (serveur MCP, scripts), `after` lève aussitôt : la tâche part alors détachée,
 * dans un processus qui vit assez longtemps pour la finir (le serveur MCP dure autant que la session).
 */
export function enFond(tache: () => Promise<unknown>): void {
  try {
    after(tache);
  } catch {
    tache().catch((erreur: unknown) => console.error('tâche de fond en échec :', erreur));
  }
}
