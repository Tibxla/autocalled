import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, journalMcp } from '@/db/schema';
import { creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
import { fauxPont } from '../test/faux-pont';
import { entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

/**
 * Test de fumée : le vrai serveur, lancé comme Claude Code le lance d'après `.mcp.json`, depuis la racine du
 * dépôt, sur la base de test et un faux pont. Prouve le crochet de résolution, le `cd`, le chargement de lib/
 * hors de Next, et le refus d'un geste confirmé quand le client ne propose pas l'élicitation.
 */
describe('serveur MCP en stdio', () => {
  it('répond à tools/list, lit, écrit, et refuse un appel sans élicitation', { timeout: 30_000 }, async () => {
    const e = await entrepriseDeTest();
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const pont = await fauxPont();
    const racine = new URL('../../../', import.meta.url).pathname;
    const { command, args } = JSON.parse(readFileSync(`${racine}.mcp.json`, 'utf8')).mcpServers.autocalled as { command: string; args: string[] };
    // `--env-file` ne remplace pas une variable déjà posée : la base et le pont restent ceux du test. Le reste de
    // .env (clés ElevenLabs, jeton Claude) est chargé et les gardes de test/garde-fous.ts ne s'appliquent pas à ce
    // processus : n'y appeler que des outils qui s'arrêtent avant ElevenLabs et `claude -p`.
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: racine,
      env: { PATH: process.env.PATH ?? '', DATABASE_URL: process.env.DATABASE_URL ?? '', PONT_URL: pont.url, PONT_SECRET: 'secret-de-test' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'fumee', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['lister_entreprises', 'importer_fiches', 'lancer_appel']));

      const lecture = await client.callTool({ name: 'lister_entreprises', arguments: {} });
      expect(lecture.content?.[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"entreprise": "gite-fictif"') });

      const ecriture = await client.callTool({ name: 'importer_fiches', arguments: { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 01')] } });
      expect(ecriture.isError).toBeFalsy();
      expect(await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')])).toMatchObject({ inchanges: ['julie'] });

      const appel = await client.callTool({ name: 'lancer_appel', arguments: { entreprise: 'gite-fictif', prospect: 'julie', versionScriptId, ligne: 'bluetooth' } });
      expect(appel.isError).toBe(true);
      expect(appel.content?.[0]).toMatchObject({ text: expect.stringContaining('à faire depuis l’interface') });
      expect(pont.compositions()).toHaveLength(0);
      expect(await db.$count(appels)).toBe(0);
      expect((await db.select().from(journalMcp)).map((j) => [j.outil, j.resultat])).toEqual(
        expect.arrayContaining([
          ['importer_fiches', 'ok'],
          ['lancer_appel', 'refus'],
        ]),
      );
    } finally {
      await client.close();
      await pont.fermer();
    }
  });
});
