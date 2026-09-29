import { createHash } from 'node:crypto';
import { type McpServer, type ServerContext, inputRequired, inputResponse } from '@modelcontextprotocol/server';
import { type Issue, refus } from './outil';

/**
 * Confirmation humaine des gestes irréversibles (ADR 0009) : faire sonner le téléphone, révoquer un numéro,
 * renvoyer une invitation à un prospect, relever les plafonds de la ligne.
 *
 * Le modèle peut être manipulé par ce qu'il lit (une transcription d'appel est la parole d'un tiers, ADR 0005) :
 * la garde est donc une question posée à l'opérateur par l'élicitation MCP, que Claude Code lui affiche et à
 * laquelle le modèle ne peut pas répondre. Le message est rédigé ici, depuis la base, jamais à partir d'un
 * texte fourni par le modèle. Sans élicitation (client qui ne la déclare pas, `claude -p`), le geste est refusé.
 *
 * L'outil rend `inputRequired(...)`, la forme du SDK v2 pour les deux révisions du protocole : en 2025 (celle
 * que sert le transport stdio), le SDK pose lui-même la question au client puis rappelle l'outil ; en 2026-07-28,
 * c'est le client qui rappelle l'outil avec la réponse. L'outil repasse donc depuis le début : il revérifie
 * tout, et n'accepte la réponse que si les faits qui portent la décision (`cle` : prospect, numéro, valeurs
 * cibles…) n'ont pas bougé depuis la question (empreinte gardée dans `requestState`). Le message, lui, peut
 * changer sans invalider l'accord : il rappelle l'heure, et l'opérateur peut mettre plus d'une minute à répondre.
 */

const CLE = 'confirmation';

export type Garde = { etat: 'acceptee' } | { etat: 'refusee' } | { etat: 'indisponible' } | { etat: 'a-demander'; issue: Issue };

function formulaireAccepte(serveur: McpServer): boolean {
  const e = serveur.server.getClientCapabilities()?.elicitation;
  // Une capacité vide vaut « formulaire » (compatibilité de la spécification) ; `url` seul ne suffit pas.
  return e !== undefined && (e.form !== undefined || e.url === undefined);
}

export function confirmer(serveur: McpServer, ctx: ServerContext, message: string, cle: readonly unknown[]): Garde {
  const empreinte = createHash('sha256').update(JSON.stringify(cle)).digest('hex');
  const reponse = inputResponse(ctx.mcpReq.inputResponses, CLE);
  if (reponse.kind !== 'missing' && ctx.mcpReq.requestState<string>() === empreinte) {
    const accord = reponse.kind === 'elicit' && reponse.action === 'accept' && reponse.content?.confirme === true;
    return { etat: accord ? 'acceptee' : 'refusee' };
  }
  if (!formulaireAccepte(serveur)) return { etat: 'indisponible' };
  return {
    etat: 'a-demander',
    issue: {
      demande: inputRequired({
        requestState: empreinte,
        inputRequests: {
          [CLE]: inputRequired.elicit({
            message,
            requestedSchema: {
              type: 'object',
              properties: { confirme: { type: 'boolean', title: 'Je confirme', description: 'Coche pour autoriser ce geste. Sinon, refuse.' } },
              required: ['confirme'],
            },
          }),
        },
      }),
    },
  };
}

/** Refus d'un geste non confirmé, avec la raison à rapporter à l'opérateur. */
export function refusDeConfirmation(garde: { etat: 'refusee' | 'indisponible' }): Issue {
  return garde.etat === 'refusee'
    ? refus('L’opérateur n’a pas confirmé : rien n’a été fait.', 'refusee')
    : refus(
        'Ce geste demande la confirmation de l’opérateur, et ce client MCP ne sait pas la demander (élicitation absente, ou mode non interactif) : à faire depuis l’interface.',
        'indisponible',
      );
}

/** Heure de Paris, rappelée dans les confirmations d'appel : aucune règle d'heure ne protège un appel, c'est à l'opérateur d'en juger. */
export const heureDeParis = () => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date());
