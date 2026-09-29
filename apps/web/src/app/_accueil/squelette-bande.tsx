/**
 * Place de la bande pendant la lecture de la ligne (le pont peut mettre jusqu'à 15 s) : même hauteur que la
 * bande d'appel, pour que la frise et le tableau ne sautent pas quand elle arrive. Statique, sans animation.
 */
export function SqueletteBande() {
  return (
    <div className="grid min-h-[188px] grid-cols-1 content-start gap-3.5 max-sm:min-h-[120px]">
      <div className="flex h-9 items-center">
        <p role="status" className="text-lg font-semibold text-encre-3">
          Lecture de la ligne…
        </p>
      </div>
      <div aria-hidden="true" className="flex min-h-[84px] flex-col items-center justify-end gap-2 pb-0.5 max-sm:min-h-0">
        <div className="h-3.5 w-[18rem] max-w-full rounded-[3px] bg-survol" />
        <div className="h-7 w-[32rem] max-w-full rounded-[3px] bg-survol" />
      </div>
      <AxePiste />
    </div>
  );
}

/** L'axe de la piste de parole, immobile : la bande sans appel garde la forme de la bande vivante. */
export function AxePiste() {
  return (
    <div aria-hidden="true" className="relative h-10 max-sm:h-8">
      <div className="absolute inset-x-0 top-1/2 h-px bg-filet-2" />
    </div>
  );
}
