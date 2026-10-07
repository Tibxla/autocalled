import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const generer = vi.hoisted(() => vi.fn(async () => new Uint8Array([73, 68, 51]).buffer));
vi.mock('@/lib/catalogue-assistante', async (original) => ({ ...(await original<Record<string, unknown>>()), genererApercuVoix: generer }));
import { POST } from './route';
const saisie = { voiceId: 'VoixFictive001', modele: 'eleven_fictif', stabilite: 0.35, similarite: 0.75, vitesse: 1 };
const envoyer = (corps: unknown, login = 'operateur@example.com', origine = 'http://127.0.0.1') => POST(new Request('http://127.0.0.1/api/assistante/apercu', { method: 'POST', headers: { host: '127.0.0.1', 'tailscale-user-login': login, origin: origine, 'content-type': 'application/json' }, body: JSON.stringify(corps) }));
beforeEach(() => { vi.stubEnv('OPERATEUR_TAILSCALE_LOGIN', 'operateur@example.com'); generer.mockReset(); generer.mockResolvedValue(new Uint8Array([73, 68, 51]).buffer); });
afterEach(() => vi.unstubAllEnvs());
describe('écouter une voix depuis l’interface', () => {
  it('réserve la synthèse à l’opérateur sur l’origine de l’interface', async () => {
    expect((await envoyer(saisie, 'visiteur@example.com')).status).toBe(403);
    expect((await envoyer(saisie, 'operateur@example.com', 'https://autre.example.com')).status).toBe(403);
    expect(generer).not.toHaveBeenCalled();
    const r = await envoyer(saisie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
  });
  it('refuse le texte libre et les réglages invalides avant de générer du son', async () => {
    expect((await envoyer({ ...saisie, texte: 'Texte à ne pas transmettre' })).status).toBe(400);
    expect((await envoyer({ ...saisie, vitesse: 5 })).status).toBe(400);
    expect(generer).not.toHaveBeenCalled();
  });
  it('ne renvoie aucun détail privé du fournisseur en cas de refus', async () => {
    generer.mockRejectedValueOnce(new Error('cle-secrete et détails privés'));
    const r = await envoyer(saisie);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain('cle-secrete');
  });
});
