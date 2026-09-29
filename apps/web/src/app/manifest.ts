import type { MetadataRoute } from 'next';

/** Installation sobre sur l'écran d'accueil : plein écran d'application, graphite chaud, l'icône du site. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Autocalled',
    short_name: 'Autocalled',
    description: 'Régie de l’assistante vocale de prospection.',
    start_url: '/',
    display: 'standalone',
    lang: 'fr',
    background_color: '#121110',
    theme_color: '#121110',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
