/**
 * Tâches longues du serveur MCP, dans un processus détaché qui survit à la session Claude Code (une campagne
 * simulée dure de dix à trente minutes) :
 *
 *   node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts mcp/tache.ts derouler-simulation <campagneId>
 *
 * Les échecs se lisent sur les appels eux-mêmes (statut `echec` et son erreur), comme dans l'interface.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Detacher = (tache: 'derouler-simulation', id: string) => void;

/** Relance ce fichier avec les options de Node du processus courant (fichier .env, condition, crochet). */
export const detacherTache: Detacher = (tache, id) => {
  spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), tache, id], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  }).unref();
};

if (import.meta.main) {
  const [tache, id] = process.argv.slice(2);
  const { db } = await import('@/db');
  const { derouleSimulation } = await import('@/lib/campagnes');
  try {
    if (tache === 'derouler-simulation' && id) await derouleSimulation(id);
    else {
      console.error('usage : mcp/tache.ts derouler-simulation <campagneId>');
      process.exitCode = 2;
    }
  } finally {
    await db.$client.end();
  }
}
