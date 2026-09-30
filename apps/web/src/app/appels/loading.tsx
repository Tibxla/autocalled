import { EnTetePage, Page, SqueletteListe } from '@/components/ui';

/**
 * La liste se relit (filtre, recherche, fenêtre suivante) : en-tête figé, filtres et lignes en squelette. Sous 640 px,
 * même forme que la page : la recherche en tête, une rangée de filtres, puis le bouton du volet « Filtres ».
 */
export default function ChargementAppels() {
  return (
    <Page>
      <EnTetePage titre="Appels" sousTitre="Du plus récent au plus ancien." />
      <div aria-hidden="true" className="grid gap-3 border-b border-filet pb-3">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3 max-sm:flex-col-reverse max-sm:items-stretch">
          <div className="flex flex-wrap gap-x-[22px] gap-y-2 py-1 max-sm:flex-nowrap max-sm:overflow-hidden pointer-coarse:py-[15px]">
            {[28, 104, 96, 112, 36, 140, 72, 76, 72].map((l, i) => (
              <span key={i} className="h-3.5 shrink-0 rounded-[3px] bg-survol" style={{ width: l }} />
            ))}
          </div>
          <span className="h-[30px] w-full border-b border-filet-fort sm:w-[360px] pointer-coarse:h-11" />
        </div>
        <div className="flex h-11 items-center sm:hidden">
          <span className="h-3.5 w-16 rounded-[3px] bg-survol" />
        </div>
        <div className="flex flex-wrap gap-x-[22px] gap-y-2 py-1 max-sm:hidden">
          {[44, 68, 72, 56].map((l, i) => (
            <span key={i} className="h-3 rounded-[3px] bg-survol" style={{ width: l }} />
          ))}
        </div>
      </div>
      <p className="sr-only" role="status">
        Chargement des appels…
      </p>
      <SqueletteListe lignes={12} />
    </Page>
  );
}
