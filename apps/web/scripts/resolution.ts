/**
 * Crochet de résolution pour exécuter le code serveur de l'application hors de Next :
 * alias `@/` vers `src/`, et imports relatifs sans extension vers leur fichier `.ts`.
 * À lancer avec `node --conditions=react-server --import ./scripts/resolution.ts …`
 * (la condition `react-server` rend `server-only` inoffensif).
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));

function versFichier(chemin: string): string | undefined {
  for (const candidat of [chemin, `${chemin}.ts`, `${chemin}.tsx`, `${chemin}/index.ts`]) {
    if (existsSync(candidat) && !candidat.endsWith('/') && /\.[cm]?[jt]sx?$/.test(candidat)) return candidat;
  }
  return undefined;
}

registerHooks({
  resolve(specifier, context, suivant) {
    let base: string | undefined;
    if (specifier.startsWith('@/')) base = src + specifier.slice(2);
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const fichier = base && versFichier(base);
    return fichier ? suivant(pathToFileURL(fichier).href, context) : suivant(specifier, context);
  },
});
