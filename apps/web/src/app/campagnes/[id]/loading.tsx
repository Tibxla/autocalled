import { SqueletteListe } from '@/components/ui';

/** Retour immédiat pendant la lecture de la campagne, de l'agenda et de la ligne. */
export default function ChargementCampagne() {
  return (
    <div aria-busy="true" aria-label="Chargement de la campagne">
      <div aria-hidden="true" className="grid gap-2 pt-8 pb-5">
        <div className="h-3 w-44 rounded-[3px] bg-survol" />
        <div className="h-5 w-72 rounded-[3px] bg-survol" />
        <div className="h-3 w-56 rounded-[3px] bg-survol" />
      </div>
      <div aria-hidden="true" className="grid gap-3 border-b border-filet pb-8">
        <div className="h-5 w-96 max-w-full rounded-[3px] bg-survol" />
        <div className="h-3 w-40 rounded-[3px] bg-survol" />
      </div>
      <SqueletteListe lignes={10} />
    </div>
  );
}
