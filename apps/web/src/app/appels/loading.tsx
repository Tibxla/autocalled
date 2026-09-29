import { EnTetePage, Page, SqueletteListe } from '@/components/ui';

/** La liste se relit (filtre, recherche, fenêtre suivante) : en-tête figé, filtres et lignes en squelette. */
export default function ChargementAppels() {
  return (
    <Page>
      <EnTetePage titre="Appels" sousTitre="Du plus récent au plus ancien." />
      <div aria-hidden="true" className="grid gap-3 border-b border-filet pb-3">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div className="flex flex-wrap gap-x-[22px] gap-y-2 py-1">
            {[28, 104, 96, 112, 36, 140, 72, 76, 72].map((l, i) => (
              <span key={i} className="h-3.5 rounded-[3px] bg-survol" style={{ width: l }} />
            ))}
          </div>
          <span className="h-[30px] w-full border-b border-filet-fort sm:w-[300px]" />
        </div>
        <div className="flex flex-wrap gap-x-[22px] gap-y-2 py-1">
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
