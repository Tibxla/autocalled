import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Un seul .env, à la racine du dépôt, partagé avec les scripts et Docker Compose.
loadEnvConfig(`${import.meta.dirname}/../..`, process.env.NODE_ENV !== 'production', undefined, true);

const nextConfig: NextConfig = {
  transpilePackages: ['@autocalled/domain', '@autocalled/agenda'],
  // Un import envoie jusqu'à cent fiches de 32 Ko.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
};

export default nextConfig;
