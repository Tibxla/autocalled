import { SqueletteListe } from '@/components/ui';

/** Retour immédiat pendant la lecture des campagnes et de leurs appels. */
export default function ChargementCampagnes() {
  return (
    <div aria-busy="true" aria-label="Chargement des campagnes">
      <SqueletteListe titre lignes={6} />
    </div>
  );
}
