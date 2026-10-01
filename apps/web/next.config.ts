import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Un seul .env, à la racine du dépôt, partagé avec les scripts et Docker Compose.
loadEnvConfig(`${import.meta.dirname}/../..`, process.env.NODE_ENV !== 'production', undefined, true);

/**
 * L'identité Tailscale suit toute requête partie d'un appareil de l'opérateur (ADR 0006), même lancée par une page
 * tierce : aucune page ne se laisse donc encadrer (clic détourné sur « Lancer » ou « Effacer »). `same-origin` et
 * non `no-referrer` : ce dernier ferait envoyer `Origin: null` aux actions serveur, que Next refuserait.
 */
const entetesDeSecurite = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  // Le micro sert à la ligne navigateur et à la prise de main.
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@autocalled/domain', '@autocalled/agenda'],
  // Un import envoie jusqu'à cent fiches de 32 Ko.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: entetesDeSecurite }];
  },
};

export default nextConfig;
