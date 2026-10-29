import { type Campagne, debuterAppel } from '@autocalled/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appelerSuivantTelephone } from '@/lib/campagnes';
import { POST } from './route';

const memoire = vi.hoisted(() => ({
  campagne: null as Campagne | null,
  appel: null as { id: string; campagneId: string | null; conversationId: string | null; sens: 'sortant' | 'entrant' } | null,
  depart: 0,
  etat: {} as Record<string, unknown>,
  refus: 0,
  taches: [] as (() => Promise<unknown>)[],
}));

// Les transitions de campagne et la route sont réelles ; seuls SQL, le pont et la préparation sont remplacés.
vi.mock('@/db', async () => {
  const { campagnes } = await import('@/db/schema');
  const sql = {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const lignes = table === campagnes ? (memoire.campagne ? [memoire.campagne] : []) : (memoire.appel ? [memoire.appel] : []);
      return Object.assign(Promise.resolve(lignes), { for: async () => lignes });
    } }) }),
    update: (table: unknown) => ({ set: (valeurs: Partial<Campagne>) => ({ where: async () => {
      if (table === campagnes && memoire.campagne) Object.assign(memoire.campagne, valeurs);
    } }) }),
    delete: () => ({ where: async () => { memoire.appel = null; } }),
    insert: () => ({ values: () => ({ returning: async () => {
      memoire.appel = { id: APPEL, campagneId: CAMPAGNE, conversationId: null, sens: 'sortant' };
      return [{ id: APPEL }];
    } }) }),
  };
  return { db: { ...sql, transaction: async (executer: (tx: typeof sql) => Promise<unknown>) => executer(sql) } };
});
vi.mock('@/lib/appels', () => ({
  preparerAppel: async () => ({ ok: true, numero: '+33639980001', variables: {}, motsCles: [], premierMessage: 'Message fictif.', ouverture: null }),
  traiterAppel: vi.fn(),
}));
vi.mock('next/server', () => ({ after: (tache: () => Promise<unknown>) => memoire.taches.push(tache) }));

const APPEL = '00000000-0000-4000-8000-000000000001';
const CAMPAGNE = '00000000-0000-4000-8000-000000000002';
const passe = ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  memoire.campagne = {
    id: CAMPAGNE, entrepriseId: 'entreprise-fictive', versionScriptId: 'version-fictive', statut: 'en-cours',
    entrees: [{ prospectId: 'fictif', etat: 'a-appeler', tentative: 3, appelsPrecedents: [...passe] }],
  };
  memoire.appel = null;
  memoire.depart = 0;
  memoire.etat = {};
  memoire.refus = 0;
  memoire.taches = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/etat')) return Response.json(memoire.etat);
    memoire.depart++;
    return memoire.refus ? Response.json({ erreur: 'quota_exceeded' }, { status: memoire.refus }) : Response.json({ ok: true });
  });
});

function fin(corps: unknown) {
  return POST(new Request('http://exemple.test/fin', { method: 'POST', headers: { authorization: 'Bearer secret-de-test' }, body: JSON.stringify(corps) }),
    { params: Promise.resolve({ id: APPEL }) });
}

describe('pause pour assistante indisponible, sans PostgreSQL', () => {
  it.each([null, 'conversation-fictive'])('fin silencieuse, conversation %s : garde la troisième tentative due et son historique', async (conversationId) => {
    memoire.campagne = debuterAppel(memoire.campagne!, 'fictif', APPEL, new Date());
    memoire.appel = { id: APPEL, campagneId: CAMPAGNE, sens: 'sortant', conversationId };
    expect((await fin({ raison: 'assistante indisponible', conversationId, sansParole: true })).status).toBe(200);
    expect(memoire.campagne).toMatchObject({ statut: 'en-pause', entrees: [{ etat: 'a-appeler', tentative: 3, appelsPrecedents: passe }] });
    expect(memoire.appel).toBeNull();
    expect(memoire.taches).toHaveLength(0);
    expect(memoire.depart).toBe(0);
    expect(console.warn).toHaveBeenCalledWith('[campagne] pause automatique', { campagneId: CAMPAGNE, phase: 'fin', raison: 'assistante-indisponible' });
  });

  it('un entrant silencieux met aussi la campagne téléphone en pause sans relance', async () => {
    memoire.appel = { id: APPEL, campagneId: null, sens: 'entrant', conversationId: null };
    await fin({ raison: 'assistante indisponible', sansParole: true });
    expect(memoire.campagne?.statut).toBe('en-pause');
    expect(memoire.appel).toBeNull();
    expect(memoire.taches).toHaveLength(0);
    expect(memoire.depart).toBe(0);
  });

  it('/etat indisponible : pause avant de créer ou composer un appel', async () => {
    memoire.etat = { assistanteIndisponible: { raison: 'quota_exceeded', quota: true } };
    await appelerSuivantTelephone(CAMPAGNE);
    expect(memoire.campagne?.statut).toBe('en-pause');
    expect(memoire.appel).toBeNull();
    expect(memoire.depart).toBe(0);
  });

  it.each([424, 503, 429])('refus %i : tentative conservée ; seul 424 met en pause', async (statut) => {
    memoire.refus = statut;
    await appelerSuivantTelephone(CAMPAGNE);
    expect(memoire.campagne).toMatchObject({ statut: statut === 424 ? 'en-pause' : 'en-cours',
      entrees: [{ etat: 'a-appeler', tentative: 3, appelsPrecedents: passe }] });
    expect(memoire.appel).toBeNull();
    expect(memoire.depart).toBe(1);
  });
});
