import { SqueletteListe } from '@/components/ui';

/** Retour immédiat pendant la lecture de la fiche et de l'agenda : les deux colonnes de la fiche. */
export default function ChargementProspect() {
  return (
    <div aria-busy="true" aria-label="Chargement du prospect" className="max-w-[72rem]">
      <div aria-hidden="true" className="grid gap-2 pb-8">
        <div className="h-3 w-20 rounded-[3px] bg-survol" />
        <div className="h-5 w-56 rounded-[3px] bg-survol" />
        <div className="h-3 w-40 rounded-[3px] bg-survol" />
      </div>
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div aria-hidden="true" className="grid content-start gap-3">
          <div className="h-4 w-36 rounded-[3px] bg-survol" />
          <div className="h-3 w-full max-w-[60ch] rounded-[3px] bg-survol" />
          <div className="h-3 w-4/5 max-w-[52ch] rounded-[3px] bg-survol" />
          <div className="h-3 w-3/5 max-w-[44ch] rounded-[3px] bg-survol" />
          <SqueletteListe lignes={4} />
        </div>
        <div aria-hidden="true" className="order-first grid content-start gap-3 border-t border-filet pt-4 lg:order-none">
          <div className="h-5 w-44 rounded-[3px] bg-survol" />
          <div className="h-3 w-24 rounded-[3px] bg-survol" />
          <div className="h-3 w-32 rounded-[3px] bg-survol" />
        </div>
      </div>
    </div>
  );
}
