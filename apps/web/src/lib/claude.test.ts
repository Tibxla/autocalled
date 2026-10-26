import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ModuleClaude from './claude';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

describe('claudeStructure : authentification', () => {
  it.each([
    { usage: 'analyseur', outilsMcp: undefined, attente: undefined },
    { usage: 'lecture agenda', outilsMcp: ['mcp__claude_ai_Google_Calendar__suggest_time'], attente: 'false' },
    { usage: 'création agenda', outilsMcp: ['mcp__claude_ai_Google_Calendar__create_event'], attente: 'false' },
  ])('$usage : transmet le jeton, et attend les connecteurs quand il en faut', async ({ outilsMcp, attente }) => {
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'jeton-fictif');
    const enfant = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockImplementation(() => {
      enfant.stdin.on('finish', () => {
        enfant.stdout.write(JSON.stringify({ structured_output: { ok: true } }));
        enfant.emit('close', 0);
      });
      return enfant as unknown as ReturnType<typeof spawn>;
    });
    const { claudeStructure } = await vi.importActual<typeof ModuleClaude>('./claude');
    await expect(claudeStructure({ prompt: 'Essai fictif', schema: {}, modele: 'haiku', outilsMcp })).resolves.toEqual({ ok: true });
    const env = vi.mocked(spawn).mock.lastCall![2]!.env!;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('jeton-fictif');
    expect(env.MCP_CONNECTION_NONBLOCKING).toBe(attente);
    expect(env.HOME).toBe(process.env.HOME);
  });
});
