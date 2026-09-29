import { Page } from '@/components/ui';

const LARGEURS = ['62%', '48%', '70%', '38%', '56%', '66%', '44%', '58%'];

/** Squelette statique de la fiche : en-tête, bloc issue, puis transcription et bilan. */
export default function ChargementAppel() {
  return (
    <Page largeur="lecture">
      <p className="sr-only" role="status">
        Chargement de l’appel…
      </p>
      <div aria-hidden="true">
        <div className="grid gap-2.5 pt-8 pb-5 max-sm:pt-6">
          <span className="h-3 w-16 rounded-[3px] bg-survol" />
          <span className="h-5 w-56 rounded-[3px] bg-survol" />
          <span className="h-3 w-72 max-w-full rounded-[3px] bg-survol" />
        </div>
        <div className="flex items-center gap-3 border-y border-filet py-5">
          <span className="h-5 w-[3px] bg-trait-2" />
          <span className="h-4 w-40 rounded-[3px] bg-survol" />
        </div>
        <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-4">
            {LARGEURS.map((l, i) => (
              <div key={i} className="grid grid-cols-[3rem_1fr] gap-4">
                <span className="h-3 w-8 rounded-[3px] bg-survol" />
                <span className="h-3 rounded-[3px] bg-survol" style={{ width: l }} />
              </div>
            ))}
          </div>
          <div className="grid content-start gap-3 max-lg:order-first">
            {['90%', '80%', '85%', '40%'].map((l, i) => (
              <span key={i} className="h-3 rounded-[3px] bg-survol" style={{ width: l }} />
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}
