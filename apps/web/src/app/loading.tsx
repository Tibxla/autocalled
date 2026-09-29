import { SqueletteListe } from '@/components/ui';

/** Changements de segment de premier niveau seulement ; chaque groupe pose ses propres loading.tsx. */
export default function Chargement() {
  return <SqueletteListe titre lignes={10} />;
}
