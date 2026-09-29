import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { confirmer } from './confirmation';

/** Un serveur dont le client déclare (ou non) l'élicitation, et le contexte d'un passage de l'outil. */
const serveur = (elicitation: object | undefined) => ({ server: { getClientCapabilities: () => (elicitation ? { elicitation } : {}) } }) as unknown as McpServer;
const passage = (reponse?: object, etat?: string) =>
  ({ mcpReq: { inputResponses: reponse ? { confirmation: reponse } : undefined, requestState: () => etat } }) as unknown as ServerContext;

function premiereQuestion(message: string, cle: unknown[]): string {
  const garde = confirmer(serveur({ form: {} }), passage(), message, cle);
  if (garde.etat !== 'a-demander' || !('demande' in garde.issue)) throw new Error(`question attendue, reçu ${garde.etat}`);
  return garde.issue.demande.requestState ?? '';
}

describe('confirmer', () => {
  const accord = { action: 'accept', content: { confirme: true } };

  it('garde l’accord quand seul le texte a changé (l’heure y passe d’une minute à l’autre)', () => {
    const etat = premiereQuestion('Appeler maintenant… Nous sommes mardi 10:41.', ['lancer_appel', 'julie']);

    expect(confirmer(serveur({ form: {} }), passage(accord, etat), 'Appeler maintenant… Nous sommes mardi 10:42.', ['lancer_appel', 'julie'])).toEqual({ etat: 'acceptee' });
  });

  it('repose la question si les faits ont changé depuis', () => {
    const etat = premiereQuestion('Appeler Julie', ['lancer_appel', 'julie', '+33639980001']);

    expect(confirmer(serveur({ form: {} }), passage(accord, etat), 'Appeler Julie', ['lancer_appel', 'julie', '+33639980002']).etat).toBe('a-demander');
  });

  it.each([
    ['un refus', { action: 'decline' }],
    ['une annulation', { action: 'cancel' }],
    ['une case non cochée', { action: 'accept', content: { confirme: false } }],
  ])('refuse sur %s', (_, reponse) => {
    const etat = premiereQuestion('Révoquer', ['revoquer_numero']);

    expect(confirmer(serveur({ form: {} }), passage(reponse, etat), 'Révoquer', ['revoquer_numero'])).toEqual({ etat: 'refusee' });
  });

  it('ne demande rien à un client sans élicitation par formulaire', () => {
    expect(confirmer(serveur(undefined), passage(), 'Révoquer', ['x'])).toEqual({ etat: 'indisponible' });
    expect(confirmer(serveur({ url: {} }), passage(), 'Révoquer', ['x'])).toEqual({ etat: 'indisponible' });
    expect(confirmer(serveur({}), passage(), 'Révoquer', ['x']).etat).toBe('a-demander');
  });
});
