import 'server-only';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Lance `claude -p` pour une tâche fermée qui rend un JSON validé par un schéma (ADR 0005). Jamais
 * d'outil intégré (ni shell, ni fichiers), jamais la mémoire ni le CLAUDE.md de l'opérateur, dans un
 * dossier vide. Seuls les outils MCP nommés dans `outilsMcp` sont permis.
 */
export async function claudeStructure(options: {
  prompt: string;
  schema: object;
  modele: 'sonnet' | 'haiku';
  outilsMcp?: string[];
  delaiMs?: number;
}): Promise<unknown> {
  const dossier = join(tmpdir(), 'autocalled-claude');
  await mkdir(dossier, { recursive: true });
  const args = [
    '-p',
    '--model', options.modele,
    '--tools', '',
    '--settings', '{"autoMemoryEnabled":false}',
    '--no-session-persistence',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(options.schema),
    // Sans outil MCP, on coupe aussi les serveurs MCP et les réglages utilisateur.
    ...(options.outilsMcp?.length
      ? ['--allowedTools', options.outilsMcp.join(',')]
      : ['--strict-mcp-config', '--setting-sources', 'project']),
  ];
  const env: Record<string, string | undefined> = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    LANG: 'fr_FR.UTF-8',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  return new Promise((resoudre, rejeter) => {
    const enfant = spawn('claude', args, { cwd: dossier, env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let sortie = '';
    let erreur = '';
    const minuterie = setTimeout(() => enfant.kill('SIGKILL'), options.delaiMs ?? 180_000);
    enfant.stdout.on('data', (d) => (sortie += d));
    enfant.stderr.on('data', (d) => (erreur += d));
    enfant.on('error', rejeter);
    enfant.on('close', (code) => {
      clearTimeout(minuterie);
      try {
        const r = JSON.parse(sortie) as { is_error?: boolean; result?: string; structured_output?: unknown };
        if (r.is_error) return rejeter(new Error(`claude : ${r.result ?? 'erreur inconnue'}`));
        resoudre(r.structured_output ?? JSON.parse(r.result ?? 'null'));
      } catch {
        rejeter(new Error(`claude : sortie illisible (code ${code}) ${erreur.slice(0, 200)}`));
      }
    });
    enfant.stdin.end(options.prompt);
  });
}
