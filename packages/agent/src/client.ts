import type { Json } from './configuration.ts';

/** Ce que le code demande à ElevenLabs : lire l'agent, le modifier, le créer. Les tests en injectent un faux. */
export interface ClientAgent {
  lire(): Promise<Json>;
  modifier(config: Json): Promise<void>;
  /** Crée l'agent et rend son identifiant. */
  creer(config: Json): Promise<string>;
}

const API = 'https://api.elevenlabs.io/v1/convai/agents';

export function clientElevenLabs(o: { cle: string; agentId?: string | undefined }): ClientAgent {
  async function api(chemin: string, init: RequestInit = {}): Promise<Json> {
    const reponse = await fetch(`${API}${chemin}`, {
      ...init,
      headers: { 'xi-api-key': o.cle, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!reponse.ok) throw new Error(`ElevenLabs ${reponse.status} : ${(await reponse.text()).slice(0, 500)}`);
    return (await reponse.json()) as Json;
  }
  function agent(): string {
    if (!o.agentId) throw new Error('variable d’environnement manquante : ELEVENLABS_AGENT_ID');
    return o.agentId;
  }
  return {
    lire: () => api(`/${agent()}`),
    async modifier(config) {
      await api(`/${agent()}`, { method: 'PATCH', body: JSON.stringify(config) });
    },
    async creer(config) {
      const { agent_id } = await api('/create', { method: 'POST', body: JSON.stringify(config) });
      if (typeof agent_id !== 'string') throw new Error('ElevenLabs n’a pas rendu d’identifiant d’agent.');
      return agent_id;
    },
  };
}
