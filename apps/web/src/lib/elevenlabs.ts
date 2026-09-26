import 'server-only';
import type { TourDeParole } from '@autocalled/domain';

/** Client minimal de l'API ElevenLabs Agents, côté serveur uniquement : la clé ne quitte jamais le serveur. */

const API = 'https://api.elevenlabs.io/v1/convai';

function cle(): string {
  const valeur = process.env.ELEVENLABS_API_KEY;
  if (!valeur) throw new Error("variable d'environnement manquante : ELEVENLABS_API_KEY");
  return valeur;
}

export function agentId(): string {
  const valeur = process.env.ELEVENLABS_AGENT_ID;
  if (!valeur) throw new Error("variable d'environnement manquante : ELEVENLABS_AGENT_ID");
  return valeur;
}

async function api(chemin: string, init: RequestInit = {}): Promise<Response> {
  const reponse = await fetch(`${API}${chemin}`, {
    ...init,
    headers: { 'xi-api-key': cle(), 'content-type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  if (!reponse.ok) throw new Error(`ElevenLabs ${reponse.status} sur ${chemin} : ${(await reponse.text()).slice(0, 300)}`);
  return reponse;
}

/** Jeton d'une conversation WebRTC ; ElevenLabs attribue l'identifiant de conversation dès cet instant. */
export async function jetonConversation(): Promise<{ jeton: string; conversationId: string }> {
  const donnees = (await (await api(`/conversation/token?agent_id=${agentId()}`)).json()) as {
    token: string;
    conversation_id: string;
  };
  return { jeton: donnees.token, conversationId: donnees.conversation_id };
}

interface TourBrut {
  role: 'agent' | 'user';
  message: string | null;
  time_in_call_secs?: number;
}

function versTours(tours: TourBrut[]): TourDeParole[] {
  return tours
    .filter((t) => t.message?.trim())
    .map((t) => ({
      role: t.role === 'agent' ? 'agent' : 'prospect',
      texte: (t.message ?? '').trim(),
      secondes: t.time_in_call_secs ?? 0,
    }));
}

export interface Conversation {
  statut: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';
  transcription: TourDeParole[];
  dureeSecondes: number | null;
  audio: boolean;
  versionAgent: string | null;
}

export async function lireConversation(conversationId: string): Promise<Conversation> {
  const d = (await (await api(`/conversations/${conversationId}`)).json()) as {
    status: Conversation['statut'];
    transcript?: TourBrut[];
    metadata?: { call_duration_secs?: number };
    has_audio?: boolean;
    version_id?: string | null;
    agent_version_id?: string | null;
  };
  return {
    statut: d.status,
    transcription: versTours(d.transcript ?? []),
    dureeSecondes: d.metadata?.call_duration_secs ?? null,
    audio: d.has_audio ?? false,
    versionAgent: d.version_id ?? d.agent_version_id ?? null,
  };
}

export async function audioConversation(conversationId: string): Promise<ArrayBuffer> {
  return (await api(`/conversations/${conversationId}/audio`)).arrayBuffer();
}

/** Conversation entre Mina et un prospect joué par un modèle de langage. Sans audio. */
export async function simulerConversation(
  variables: Record<string, string>,
  personnage: string,
): Promise<TourDeParole[]> {
  const d = (await (
    await api(`/agents/${agentId()}/simulate-conversation`, {
      method: 'POST',
      body: JSON.stringify({
        simulation_specification: {
          simulated_user_config: { first_message: 'Allô ?', language: 'fr', prompt: { prompt: personnage } },
          dynamic_variables: variables,
        },
        new_turns_limit: 16,
      }),
    })
  ).json()) as { simulated_conversation: TourBrut[] };
  return versTours(d.simulated_conversation);
}
