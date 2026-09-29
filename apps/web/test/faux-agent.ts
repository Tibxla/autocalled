import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ClientAgent, enregistrerDistante, type Json } from '@autocalled/agent';
import { VARIABLES_DE_L_APPEL } from '@autocalled/domain';

/**
 * Un ElevenLabs factice et un dossier `agent/` jetable, pour tester la configuration de l'assistante sans jamais
 * joindre ElevenLabs ni toucher le vrai `agent/` (qu'un autre chantier peut modifier en même temps).
 */

/** Un prompt de test construit sur les variables de l'application, jamais recopié de agent/prompt.md. */
export const PROMPT_DE_TEST = [
  '# Personnalité',
  '',
  'Tu es {{assistante_nom}}, une assistante de test.',
  '',
  '# Ce que tu sais',
  '',
  ...VARIABLES_DE_L_APPEL.filter((v) => v !== 'assistante_nom').map((v) => `- ${v} : {{${v}}}`),
  '',
  'Tu parles simplement, en phrases courtes, et tu écoutes la personne avant de répondre. '.repeat(4),
  '',
  '# Règles',
  '',
  '- Refus ferme : tu remercies et tu raccroches.',
  '',
].join('\n');

export function configurationDistante(prompt = PROMPT_DE_TEST, version = 'agtvrsn_test1'): Json {
  return {
    agent_id: 'agent_fictif',
    version_id: version,
    name: 'Assistante de test',
    conversation_config: {
      agent: {
        first_message: '',
        language: 'fr',
        prompt: { prompt, llm: 'modele-test', temperature: 0.7, tools: [{ type: 'client', name: 'proposer_creneaux' }] },
      },
      tts: { voice_id: 'voixfictive0001', speed: 1 },
      turn: { turn_eagerness: 'normal', soft_timeout_config: { message: 'Hmm…', timeout_seconds: 1.2 } },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

export type FauxClient = ClientAgent & { etat: Json; modifications: number; panne: boolean };

/** Un faux ElevenLabs : garde la configuration envoyée et change de version à chaque modification. */
export function fauxClientAgent(): FauxClient {
  const faux: FauxClient = {
    etat: configurationDistante(),
    modifications: 0,
    panne: false,
    async lire() {
      if (faux.panne) throw new Error('réseau coupé');
      return structuredClone(faux.etat);
    },
    async modifier(config: Json) {
      faux.modifications++;
      faux.etat = { ...structuredClone(faux.etat), ...structuredClone(config), version_id: `agtvrsn_test${faux.modifications + 1}` };
    },
    async creer() {
      return 'agent_fictif';
    },
  };
  return faux;
}

/** Un dossier `agent/` jetable, synchronisé sur le faux client (fichiers et verrou). */
export async function dossierAgentDeTest(client: FauxClient): Promise<{ dossier: string; effacer: () => Promise<void> }> {
  const dossier = await mkdtemp(join(tmpdir(), 'agent-mcp-'));
  await enregistrerDistante(dossier, await client.lire());
  return { dossier, effacer: () => rm(dossier, { recursive: true, force: true }) };
}
