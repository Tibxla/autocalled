import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientAgent } from '@autocalled/agent';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { creerServeur } from '../mcp/serveur';
import type { Detacher } from '../mcp/tache';

export type Reponse = { erreur: boolean; texte: string; json: unknown; blocs: string[] };

/**
 * Un client MCP branché en mémoire sur le vrai serveur. `elicitation` simule l'opérateur devant Claude Code :
 * absente, le client ne déclare pas la capacité ; sinon il accepte, refuse ou annule chaque confirmation.
 * ElevenLabs n'est jamais joint (`clientAgent` absent vaut null) et le vrai `agent/` jamais lu : sans
 * `dossierAgent`, le serveur pointe un dossier qui n'existe pas.
 */
export async function clientDeTest(
  options: { elicitation?: 'accepter' | 'refuser' | 'annuler'; detacher?: Detacher; clientAgent?: ClientAgent | null; dossierAgent?: string } = {},
) {
  const [cote, coteServeur] = InMemoryTransport.createLinkedPair();
  const messages: string[] = [];
  const client = new Client(
    { name: 'test', version: '0' },
    { capabilities: options.elicitation ? { elicitation: { form: {} } } : {} },
  );
  if (options.elicitation) {
    const reponse = options.elicitation;
    client.setRequestHandler('elicitation/create', async (requete) => {
      messages.push(String(requete.params.message));
      if (reponse === 'accepter') return { action: 'accept', content: { confirme: true } };
      return { action: reponse === 'refuser' ? 'decline' : 'cancel' };
    });
  }
  // Par défaut, aucun processus détaché ne part d'un test : la tâche est seulement notée.
  await creerServeur({
    detacher: options.detacher ?? (() => {}),
    clientAgent: options.clientAgent ?? null,
    dossierAgent: options.dossierAgent ?? join(tmpdir(), 'autocalled-agent-absent'),
  }).connect(coteServeur);
  await client.connect(cote);

  async function appeler(nom: string, args: Record<string, unknown> = {}): Promise<Reponse> {
    const r = await client.callTool({ name: nom, arguments: args });
    const blocs = (r.content ?? []).flatMap((b) => (b.type === 'text' ? [b.text] : []));
    const texte = blocs[0] ?? '';
    let json: unknown = null;
    try {
      json = JSON.parse(texte);
    } catch {
      // Un refus est une phrase, pas du JSON.
    }
    return { erreur: Boolean(r.isError), texte, json, blocs };
  }
  return { client, appeler, messages, fermer: () => client.close() };
}
