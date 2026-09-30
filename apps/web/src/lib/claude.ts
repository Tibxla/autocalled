import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Connecteurs du compte qui n'ont rien à faire dans une tâche de l'application : refusés en plus du mode `dontAsk`. */
const CONNECTEURS_EXCLUS = ['mcp__claude_ai_Gmail', 'mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Notion'];

/**
 * Les options de `claude -p` pour une tâche fermée (ADR 0005). Dans les deux régimes : aucun outil intégré (ni shell,
 * ni fichiers), aucun fichier de réglages (`--restricted` ignore ceux de l'utilisateur, du projet et du dossier, donc
 * leurs crochets et leur mode de permission), ni mémoire ni CLAUDE.md, et le mode `dontAsk` : un outil que
 * `--allowedTools` ne nomme pas est refusé, sans question ni classifieur.
 * - Sans `outilsMcp` (analyseur) : aucun serveur MCP non plus (`--strict-mcp-config`).
 * - Avec `outilsMcp` (agenda) : les connecteurs du compte restent chargés (le Google Agenda de Claude en est un),
 *   mais seuls les outils nommés sont permis.
 */
export function argumentsClaude(options: { modele: string; schema: object; outilsMcp?: string[] }): string[] {
  return [
    '-p',
    '--model', options.modele,
    '--tools', '',
    '--restricted',
    '--permission-mode', 'dontAsk',
    '--settings', '{"autoMemoryEnabled":false}',
    '--no-session-persistence',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(options.schema),
    ...(options.outilsMcp?.length
      ? ['--allowedTools', options.outilsMcp.join(','), '--disallowedTools', CONNECTEURS_EXCLUS.join(',')]
      : ['--strict-mcp-config']),
  ];
}

/**
 * Lance `claude -p` pour une tâche fermée qui rend un JSON validé par un schéma (voir `argumentsClaude`), dans un
 * dossier vide propre à l'appel (0700, supprimé ensuite) : aucun autre compte ne peut y déposer de réglages.
 */
export async function claudeStructure(options: {
  prompt: string;
  schema: object;
  modele: 'sonnet' | 'haiku';
  outilsMcp?: string[];
  delaiMs?: number;
}): Promise<unknown> {
  const dossier = await mkdtemp(join(tmpdir(), 'autocalled-claude-'));
  const args = argumentsClaude(options);
  const env: Record<string, string | undefined> = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    LANG: 'fr_FR.UTF-8',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  try {
    return await new Promise((resoudre, rejeter) => {
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
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}
