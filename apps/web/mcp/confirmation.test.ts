import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { associerGardien, confirmer, creerGardien, type EtatConfirmation } from './confirmation';

/** Un serveur dont le client déclare (ou non) l'élicitation, lié à un gardien (clé et nonces) comme par creerServeur. */
function serveur(elicitation: object | undefined) {
  const faux = { server: { getClientCapabilities: () => (elicitation ? { elicitation } : {}) } } as unknown as McpServer;
  const gardien = creerGardien();
  associerGardien(faux, gardien);
  return { faux, gardien };
}

/** Le contexte d'un passage de l'outil ; `etat` est ce que le SDK remet à l'outil, déjà vérifié et décodé. */
const passage = (reponse?: object, etat?: unknown) =>
  ({ mcpReq: { inputResponses: reponse ? { confirmation: reponse } : undefined, requestState: () => etat } }) as unknown as ServerContext;

/** Pose la question, puis décode l'état signé comme le fait le SDK (`requestState.verify`) au retour du client. */
async function premiereQuestion(s: ReturnType<typeof serveur>, message: string, cle: unknown[]): Promise<EtatConfirmation> {
  const garde = await confirmer(s.faux, passage(), message, cle);
  if (garde.etat !== 'a-demander' || !('demande' in garde.issue)) throw new Error(`question attendue, reçu ${garde.etat}`);
  return s.gardien.codec.verify(garde.issue.demande.requestState ?? '', passage());
}

describe('confirmer', () => {
  const accord = { action: 'accept', content: { confirme: true } };

  it('garde l’accord quand seul le texte a changé (l’heure y passe d’une minute à l’autre)', async () => {
    const s = serveur({ form: {} });
    const etat = await premiereQuestion(s, 'Appeler maintenant… Nous sommes mardi 10:41.', ['lancer_appel', 'julie']);

    expect(await confirmer(s.faux, passage(accord, etat), 'Appeler maintenant… Nous sommes mardi 10:42.', ['lancer_appel', 'julie'])).toEqual({ etat: 'acceptee' });
  });

  it('repose la question si les faits ont changé depuis', async () => {
    const s = serveur({ form: {} });
    const etat = await premiereQuestion(s, 'Appeler Julie', ['lancer_appel', 'julie', '+33639980001']);

    expect((await confirmer(s.faux, passage(accord, etat), 'Appeler Julie', ['lancer_appel', 'julie', '+33639980002'])).etat).toBe('a-demander');
  });

  it('ne sert un accord qu’une fois : rejoué, la question est reposée', async () => {
    const s = serveur({ form: {} });
    const etat = await premiereQuestion(s, 'Effacer', ['effacer_personne']);

    expect((await confirmer(s.faux, passage(accord, etat), 'Effacer', ['effacer_personne'])).etat).toBe('acceptee');
    expect((await confirmer(s.faux, passage(accord, etat), 'Effacer', ['effacer_personne'])).etat).toBe('a-demander');
  });

  it('ne prend jamais une chaîne brute (état non vérifié) pour un accord', async () => {
    const s = serveur({ form: {} });
    const etat = await premiereQuestion(s, 'Effacer', ['effacer_personne']);

    expect((await confirmer(s.faux, passage(accord, JSON.stringify(etat)), 'Effacer', ['effacer_personne'])).etat).toBe('a-demander');
  });

  it('signe l’état : une valeur retouchée ou signée par un autre serveur est rejetée', async () => {
    const s = serveur({ form: {} });
    const autre = serveur({ form: {} });
    const garde = await confirmer(s.faux, passage(), 'Effacer', ['effacer_personne']);
    if (garde.etat !== 'a-demander' || !('demande' in garde.issue)) throw new Error('question attendue');
    const signe = garde.issue.demande.requestState ?? '';

    await expect(s.gardien.codec.verify(`${signe.slice(0, -2)}xx`, passage())).rejects.toThrow();
    await expect(autre.gardien.codec.verify(signe, passage())).rejects.toThrow();
  });

  it.each([
    ['un refus', { action: 'decline' }],
    ['une annulation', { action: 'cancel' }],
    ['une case non cochée', { action: 'accept', content: { confirme: false } }],
  ])('refuse sur %s', async (_, reponse) => {
    const s = serveur({ form: {} });
    const etat = await premiereQuestion(s, 'Effacer', ['effacer_personne']);

    expect(await confirmer(s.faux, passage(reponse, etat), 'Effacer', ['effacer_personne'])).toEqual({ etat: 'refusee' });
  });

  it('ne demande rien à un client sans élicitation par formulaire', async () => {
    expect(await confirmer(serveur(undefined).faux, passage(), 'Effacer', ['x'])).toEqual({ etat: 'indisponible' });
    expect(await confirmer(serveur({ url: {} }).faux, passage(), 'Effacer', ['x'])).toEqual({ etat: 'indisponible' });
    expect((await confirmer(serveur({}).faux, passage(), 'Effacer', ['x'])).etat).toBe('a-demander');
  });
});

describe('confirmations coupées (défaut en production)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('le geste part sans question, même sans élicitation chez le client', async () => {
    vi.stubEnv('MCP_CONFIRMATIONS', '');
    const s = serveur(undefined);
    expect(await confirmer(s.faux, passage(), 'Effacer', ['effacer_personne'])).toEqual({ etat: 'acceptee' });
  });
});
