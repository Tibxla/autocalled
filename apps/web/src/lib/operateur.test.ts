import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '../proxy';
import { estOperateur, identiteAppelant, requeteLocaleDirecte } from './operateur';

const OPERATEUR = 'operateur@exemple.test';
const HOTE = 'serveur.tailnet-exemple.ts.net:8449';

const entetes = (e: Record<string, string>) => new Headers(e);
const requete = (chemin: string, e: Record<string, string>) => new NextRequest(`http://127.0.0.1:3020${chemin}`, { headers: e });

beforeEach(() => {
  vi.stubEnv('OPERATEUR_TAILSCALE_LOGIN', OPERATEUR);
  vi.stubEnv('ORIGINE_APP', `https://${HOTE}`);
  vi.stubEnv('OPERATEUR_DEV_LOGIN', OPERATEUR);
});
afterEach(() => vi.unstubAllEnvs());

describe('identiteAppelant', () => {
  it('reconnaît l’opérateur relayé par tailscale serve sur l’hôte de l’application', () => {
    expect(estOperateur(identiteAppelant(entetes({ host: HOTE, 'tailscale-user-login': OPERATEUR, 'x-forwarded-for': '100.64.0.2' })))).toBe(true);
  });

  it('refuse un hôte étranger, même avec l’en-tête d’identité (rebinding DNS)', () => {
    expect(identiteAppelant(entetes({ host: 'piege.exemple:3020', 'tailscale-user-login': OPERATEUR }))).toBeNull();
    expect(identiteAppelant(entetes({ 'tailscale-user-login': OPERATEUR }))).toBeNull();
  });

  it('en développement, l’identité simulée ne vaut que pour une requête locale directe', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(identiteAppelant(entetes({ host: '127.0.0.1:3020' }))).toBe(OPERATEUR);
    expect(identiteAppelant(entetes({ host: 'localhost:3020', 'x-forwarded-host': 'localhost:3020', 'x-forwarded-for': '::1' }))).toBe(OPERATEUR);
    // Relayée par tailscale serve sans identité (nœud tagué, Funnel) : rien.
    expect(identiteAppelant(entetes({ host: HOTE, 'x-forwarded-for': '100.64.0.9' }))).toBeNull();
    expect(identiteAppelant(entetes({ host: '127.0.0.1:3020', 'x-forwarded-for': '100.64.0.9' }))).toBeNull();
    expect(identiteAppelant(entetes({ host: '127.0.0.1:3020', 'tailscale-funnel-request': '?1' }))).toBeNull();
  });

  it('hors développement, jamais d’identité simulée', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(identiteAppelant(entetes({ host: '127.0.0.1:3020' }))).toBeNull();
  });
});

describe('requeteLocaleDirecte', () => {
  it('vraie pour le pont qui appelle 127.0.0.1, fausse dès qu’un mandataire est passé', () => {
    expect(requeteLocaleDirecte(entetes({ host: '127.0.0.1:3020' }))).toBe(true);
    // Ce que Next ajoute lui-même à une requête locale directe.
    expect(requeteLocaleDirecte(entetes({ host: '127.0.0.1:3020', 'x-forwarded-host': '127.0.0.1:3020', 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'http' }))).toBe(true);
    expect(requeteLocaleDirecte(entetes({ host: '127.0.0.1:3020', 'x-forwarded-for': '::ffff:127.0.0.1' }))).toBe(true);
    // tailscale serve : hôte du tailnet dans Host ou dans x-forwarded-host, ou adresse du tailnet.
    expect(requeteLocaleDirecte(entetes({ host: '127.0.0.1:3020', 'x-forwarded-host': HOTE, 'x-forwarded-for': '127.0.0.1' }))).toBe(false);
    expect(requeteLocaleDirecte(entetes({ host: HOTE }))).toBe(false);
    expect(requeteLocaleDirecte(entetes({ host: '127.0.0.1:3020', 'x-forwarded-for': '100.64.0.2' }))).toBe(false);
    expect(requeteLocaleDirecte(entetes({ host: '127.0.0.1:3020', 'tailscale-user-login': OPERATEUR }))).toBe(false);
  });
});

describe('proxy', () => {
  it('laisse passer le pont en local, cache ses routes au tailnet', () => {
    expect(proxy(requete('/api/pont/appels/x/fin', { host: '127.0.0.1:3020' })).status).toBe(200);
    const relayee = proxy(requete('/api/pont/appels/x/fin', { host: HOTE, 'x-forwarded-for': '100.64.0.2', 'tailscale-user-login': OPERATEUR }));
    expect(relayee.status).toBe(404);
  });

  it('refuse l’inconnu avec un 403 qui ne se laisse pas encadrer', () => {
    const r = proxy(requete('/', { host: HOTE, 'tailscale-user-login': 'autre@exemple.test' }));
    expect(r.status).toBe(403);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(proxy(requete('/', { host: HOTE, 'tailscale-user-login': OPERATEUR })).status).toBe(200);
  });
});
