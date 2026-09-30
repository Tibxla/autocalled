import { cleJour, heure, quandRappeler, rappelEnRetard } from '@/components/format-appel';
import { Cellule, CelluleEnTete, EnTeteTable, LienAction, LienLigne, LienTexte, LigneTable, TableDense, TitreSection } from '@/components/ui';
import type { RappelAFaire } from '@/lib/rappels';

/**
 * « À rappeler aujourd'hui » : les rappels convenus datés d'aujourd'hui et ceux en retard, du plus ancien au
 * plus tardif. Chaque ligne mène à la fiche du prospect, d'où l'appel se lance (avec sa confirmation). Un
 * rappel disparaît dès qu'un appel plus récent part vers le prospect. Rien à rappeler : la section se tait.
 */

const COLONNES = '12rem minmax(0,1fr) minmax(0,12rem) minmax(0,1fr)';

/** En retard : jour passé (compté en base), ou moment du jour passé (heure dite, matin après 12 h, après-midi après 18 h). */
function estEnRetard(r: RappelAFaire, maintenant: Date): boolean {
  return r.enRetard || rappelEnRetard(r.rappelLe, r.quand, maintenant);
}

/** Aujourd'hui : l'heure, ou le moment de la journée. Un jour passé : le jour et le moment. Le retard se lit en brique. */
function Quand({ r, maintenant }: { r: RappelAFaire; maintenant: Date }) {
  const retard = estEnRetard(r, maintenant);
  const duJour = cleJour(r.rappelLe) === cleJour(maintenant);
  const moment =
    !r.quand || r.quand.heure ? (
      <span className="font-mono text-xs">{heure(r.rappelLe)}</span>
    ) : r.quand.moment === 'matin' ? (
      'matin'
    ) : r.quand.moment === 'apres-midi' ? (
      'après-midi'
    ) : (
      'dans la journée'
    );
  return (
    <span className={retard ? 'text-encre' : 'text-encre-2'}>
      {retard ? <span className="text-alerte">En retard · </span> : null}
      {duJour ? moment : quandRappeler(r.rappelLe, r.quand, maintenant)}
    </span>
  );
}

export function RappelsDuJour({ rappels, sansDate, maintenant }: { rappels: RappelAFaire[]; sansDate: number; maintenant: string }) {
  if (rappels.length === 0 && sansDate === 0) return null;
  const quand = new Date(maintenant);
  const enRetard = rappels.filter((r) => estEnRetard(r, quand)).length;
  const lienSansDate =
    sansDate > 0 ? (
      <LienTexte href="/appels?rappels=1" className="hover:text-encre-2">
        <span className="font-mono">{sansDate}</span> rappel{sansDate > 1 ? 's' : ''} convenu{sansDate > 1 ? 's' : ''} sans date
      </LienTexte>
    ) : null;

  if (rappels.length === 0) {
    return <p className="pt-3.5 text-sm text-encre-3">{lienSansDate}</p>;
  }

  return (
    <section aria-labelledby="titre-rappels" className="grid grid-cols-1 pt-5">
      <TitreSection
        id="titre-rappels"
        action={
          <LienAction ton="discret" href="/appels?rappels=1" aria-label="Tous les rappels à faire" className="-mr-1.5 shrink-0">
            <span className="sm:hidden">Tous les rappels</span>
            <span className="max-sm:hidden">Tous les rappels à faire</span>
          </LienAction>
        }
      >
        À rappeler aujourd’hui
        <span className="ml-2.5 font-mono text-md font-normal text-encre-3">{rappels.length}</span>
        {enRetard > 0 ? (
          <span className="text-md font-normal whitespace-nowrap text-alerte">
            {' · '}
            <span className="font-mono">{enRetard}</span> en retard
          </span>
        ) : null}
      </TitreSection>
      {lienSansDate ? <p className="pt-2 text-sm text-encre-3">et {lienSansDate}</p> : null}
      <TableDense libelle="À rappeler aujourd’hui" colonnes={COLONNES} className="pt-1">
        <EnTeteTable>
          <CelluleEnTete>Quand</CelluleEnTete>
          <CelluleEnTete>Prospect</CelluleEnTete>
          <CelluleEnTete masqueeMobile>Entreprise</CelluleEnTete>
          <CelluleEnTete masqueeMobile>Convenu</CelluleEnTete>
        </EnTeteTable>
        <div role="rowgroup">
          {rappels.map((r) => (
            <LigneTable key={r.appelId}>
              <Cellule className="max-sm:order-2">
                <Quand r={r} maintenant={quand} />
              </Cellule>
              <Cellule tronquee titre={r.societe ? `${r.prospect} · ${r.societe}` : r.prospect} className="max-sm:order-1 max-sm:basis-full">
                <LienLigne href={`/entreprises/${r.entrepriseSlug}/prospects/${r.prospectId}`}>
                  <span className="font-medium">{r.prospect}</span>
                  {r.societe ? <span className="text-encre-3"> · {r.societe}</span> : null}
                </LienLigne>
              </Cellule>
              <Cellule tronquee titre={r.entreprise} masqueeMobile className="text-encre-2">
                {r.entreprise}
              </Cellule>
              <Cellule tronquee titre={r.texte ?? undefined} className="text-encre-3 max-sm:order-3">
                {r.texte ? `« ${r.texte} »` : null}
              </Cellule>
            </LigneTable>
          ))}
        </div>
      </TableDense>
    </section>
  );
}
