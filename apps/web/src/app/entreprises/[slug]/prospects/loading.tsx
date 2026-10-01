import { SqueletteListe } from '@/components/ui';

/** Retour immédiat pendant la lecture des prospects et de leurs numéros. */
export default function ChargementProspects() {
  return (
    <div aria-busy="true" aria-label="Chargement des prospects">
      <SqueletteListe titre lignes={12} />
    </div>
  );
}
