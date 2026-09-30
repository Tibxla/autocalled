import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { assistante, versionsAssistante } from '@/db/schema';
import { dossierAgentDeTest, type FauxClient, fauxClientAgent } from '../../../test/faux-agent';
import { avecBaseDeTest } from '../../../test/outils';

/**
 * Les actions serveur de la page Assistante telles que Next les appelle : l'opérateur exigé, l'entrée relue, les
 * valeurs par défaut de `.env` (ici un faux ElevenLabs et un `agent/` jetable, jamais le vrai).
 */

const etat = vi.hoisted(() => ({ operateur: true, faux: null as unknown, revalide: [] as string[] }));

vi.mock('@/lib/garde', () => ({
  exigerOperateur: async () => {
    if (!etat.operateur) throw new Error('accès réservé à l’opérateur');
    return 'operateur@example.com';
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: (chemin: string) => void etat.revalide.push(chemin) }));
// Le client ElevenLabs de `.env` devient le faux : aucune requête ne part.
vi.mock('@autocalled/agent', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  clientElevenLabs: () => etat.faux,
}));

const actions = await import('./actions');

avecBaseDeTest();

let faux: FauxClient;
let agent: Awaited<ReturnType<typeof dossierAgentDeTest>>;

beforeEach(async () => {
  faux = fauxClientAgent();
  etat.faux = faux;
  etat.operateur = true;
  etat.revalide = [];
  agent = await dossierAgentDeTest(faux);
  vi.stubEnv('DOSSIER_AGENT', agent.dossier);
  vi.stubEnv('ELEVENLABS_API_KEY', 'cle-factice');
  vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_fictif');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await agent.effacer();
});

describe('garde', () => {
  it('refuse tout geste hors de l’opérateur, avant de rien lire ni écrire', async () => {
    etat.operateur = false;

    await expect(actions.enregistrerIdentiteAction({ nom: 'Léa', connu: null })).rejects.toThrow('réservé à l’opérateur');
    await expect(actions.preparerPousseeAction()).rejects.toThrow('réservé à l’opérateur');
    await expect(actions.pousserAction({ empreinteLocale: 'x', versionIdDistante: null })).rejects.toThrow('réservé à l’opérateur');
    await expect(actions.restaurerAction('agtvrsn_test1')).rejects.toThrow('réservé à l’opérateur');
    expect(await db.$count(assistante)).toBe(0);
    expect(faux.modifications).toBe(0);
  });

  it('refuse une entrée qui n’a pas la forme de l’outil MCP', async () => {
    expect(await actions.enregistrerIdentiteAction({ connu: null })).toEqual({ ok: false, raison: 'Donne un nom ou un premier message.' });
    expect(await actions.enregistrerIdentiteAction({ nom: 'Léa', connu: 'hier' })).toMatchObject({ ok: false });
    expect(await actions.enregistrerReglagesAction({ first_message: 'Bonjour' }, 'x')).toMatchObject({ ok: false, raison: expect.stringContaining('Réglage refusé') });
    expect(await actions.enregistrerReglagesAction({ voix: { vitesse: 2 } }, 'x')).toEqual({ ok: false, raison: 'Réglage refusé (voix.vitesse) : Entre 0,7 et 1,2.' });
    expect(await actions.pousserAction({ empreinteLocale: 'x' })).toMatchObject({ ok: false });
    expect(await actions.restaurerAction('x'.repeat(101))).toMatchObject({ ok: false });
    expect(faux.modifications).toBe(0);
  });
});

describe('parcours de la page', () => {
  it('nom, réglages, différence, poussée consignée « interface », puis retour arrière à pousser', async () => {
    const question = await actions.preparerIdentiteAction({ nom: 'Léa', connu: null });
    expect(question).toMatchObject({ ok: true, lignes: expect.arrayContaining(['Changer le nom de l’assistante : « Mina » → « Léa ».']) });
    expect(await actions.enregistrerIdentiteAction({ nom: 'Léa', connu: null })).toMatchObject({ ok: true });
    expect(await db.select({ par: assistante.modifiePar }).from(assistante)).toEqual([{ par: 'interface' }]);

    const { lireFichiersAssistante } = await import('@/lib/fichiers-assistante');
    const { empreinteLocale } = (await lireFichiersAssistante(agent.dossier)).synchro;
    const reglages = await actions.enregistrerReglagesAction({ libelleTableauDeBord: 'Léa (test)' }, empreinteLocale);
    expect(reglages).toMatchObject({ ok: true, champs: ['libelleTableauDeBord'] });

    const prep = await actions.preparerPousseeAction();
    expect(prep).toMatchObject({ ok: true, difference: 'Réglages :\n  libellé du tableau de bord : « Assistante de test » → « Léa (test) »' });
    if (!prep.ok) throw new Error(prep.raison);
    expect(faux.modifications).toBe(0);

    expect(await actions.pousserAction(prep.attendu)).toMatchObject({ ok: true, versionApres: 'agtvrsn_test2' });
    expect(faux.modifications).toBe(1);
    expect(await db.select({ origine: versionsAssistante.origine }).from(versionsAssistante).orderBy(versionsAssistante.versionId)).toEqual([
      { origine: 'cli' },
      { origine: 'interface' },
    ]);

    expect(await actions.detailVersionAction('agtvrsn_test1')).toMatchObject({ ok: true, difference: expect.stringContaining('Léa (test)') });
    expect(await actions.restaurerAction('agtvrsn_test1')).toMatchObject({ ok: true, rappel: expect.stringContaining('pousse-la') });
    expect(faux.etat.name).toBe('Léa (test)');
    expect(etat.revalide.every((c) => c === '/assistante')).toBe(true);
    expect(etat.revalide.length).toBeGreaterThanOrEqual(4);
  });

  it('rapatrie une modification du tableau de bord', async () => {
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau' };
    expect(await actions.rapatrierAction()).toMatchObject({ ok: true, versionId: 'agtvrsn_tableau' });
    expect(await db.select({ origine: versionsAssistante.origine }).from(versionsAssistante)).toEqual([{ origine: 'distante' }]);
  });
});
