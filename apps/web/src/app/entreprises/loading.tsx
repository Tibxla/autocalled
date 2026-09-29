import { SqueletteListe } from '@/components/ui';

/** Liste des entreprises et entrée dans une entreprise (le layout d'entreprise lit la base avant de s'afficher). */
export default function ChargementEntreprises() {
  return <SqueletteListe titre lignes={8} />;
}
