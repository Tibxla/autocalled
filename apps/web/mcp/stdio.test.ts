import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { entrepriseDeTest } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

/**
 * Test de fumée : le vrai serveur, lancé comme Claude Code le lance d'après `.mcp.json`, depuis la racine du
 * dépôt, sur la base de test. Prouve le crochet de résolution, le `cd` et le chargement de lib/ hors de Next.
 */
describe('serveur MCP en stdio', () => {
  it('répond à tools/list et à un outil de lecture', { timeout: 30_000 }, async () => {
    await entrepriseDeTest();
    const racine = new URL('../../../', import.meta.url).pathname;
    const { command, args } = JSON.parse(readFileSync(`${racine}.mcp.json`, 'utf8')).mcpServers.autocalled as { command: string; args: string[] };
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: racine,
      env: { PATH: process.env.PATH ?? '', DATABASE_URL: process.env.DATABASE_URL ?? '' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'fumee', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('lister_entreprises');
      const r = await client.callTool({ name: 'lister_entreprises', arguments: {} });
      expect(r.isError).toBeFalsy();
      expect(r.content?.[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"entreprise": "gite-fictif"') });
    } finally {
      await client.close();
    }
  });
});
