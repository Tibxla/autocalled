import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { urlBaseDeTest } from './test/base-de-test.ts';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      // Comme `--conditions=react-server` pour les scripts : le code serveur se charge hors de Next.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)) },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'mcp/**/*.test.ts'],
    globalSetup: ['./test/migrer.ts'],
    setupFiles: ['./test/garde-fous.ts'],
    env: { DATABASE_URL: urlBaseDeTest(), PONT_SECRET: 'secret-de-test', PONT_URL: 'http://127.0.0.1:9' },
    // Une seule base pour tous les fichiers : ils passent l'un après l'autre.
    fileParallelism: false,
  },
});
