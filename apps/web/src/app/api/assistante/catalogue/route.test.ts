import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const lire = vi.hoisted(() => vi.fn(async () => ({ voix: [{ id: 'VoixFictive001', nom: 'Voix fictive' }], modelesVoix: [], modelesLangage: [], indisponibles: [] })));
vi.mock('@/lib/catalogue-assistante', () => ({ lireCatalogueAssistante: lire }));
import { GET } from './route';
const requete = (login: string) => new Request('http://127.0.0.1/api/assistante/catalogue', { headers: { host: '127.0.0.1', 'tailscale-user-login': login } });
beforeEach(() => { vi.stubEnv('OPERATEUR_TAILSCALE_LOGIN', 'operateur@example.com'); lire.mockClear(); });
afterEach(() => vi.unstubAllEnvs());
describe('catalogue des réglages vocaux', () => {
  it('reste privé et ne sollicite le fournisseur que pour l’opérateur', async () => {
    expect((await GET(requete('visiteur@example.com'))).status).toBe(403);
    expect(lire).not.toHaveBeenCalled();
    const r = await GET(requete('operateur@example.com'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ voix: [{ id: 'VoixFictive001', nom: 'Voix fictive' }] });
  });
});
