import Link from 'next/link';
import { heure, quandRappeler } from '@/components/format-appel';
import { Cellule, CelluleEnTete, EnTeteTable, LienAction, LienLigne, LigneTable, TableDense, TitreSection } from '@/components/ui';
import type { RappelAFaire } from '@/lib/rappels';

/**
 * « À rappeler aujourd'hui » : les rappels convenus datés d'aujourd'hui et ceux en retard, du plus ancien au
 * plus tardif. Chaque ligne mène à la fiche du prospect, d'où l'appel se lance (avec sa confirmation). Un
 * rappel disparaît dès qu'un appel plus récent part vers le prospect. Rien à rappeler : la section se tait.
 */

const COLONNES = '9rem minmax(0,1fr) minmax(0,12rem) minmax(0,1fr)';

/** Aujourd'hui : l'heure, ou le moment de la journée. En retard : le jour et le moment. */
function Quand({ r, maintenant }: { r: RappelAFaire; maintenant: Date }) {
  if (r.enRetard) {
    return (
      <span className="text-encre">
        <span className="sr-only">En retard : </span>
        {quandRappeler(r.rappelLe, r.quand, maintenant)}
      </span>
    );
  }
  if (!r.quand || r.quand.heure) return <span className="font-mono text-xs text-encre-2">{heure(r.rappelLe)}</span>;
  return <span className="text-encre-2">{r.quand.moment === 'matin' ? 'matin' : r.quand.moment === 'apres-midi' ? 'après-midi' : 'dans la journée'}</span>;
}

export function RappelsDuJour({ rappels, sansDate, maintenant }: { rappels: RappelAFaire[]; sansDate: number; maintenant: string }) {
  if (rappels.length === 0 && sansDate === 0) return null;
  const quand = new Date(maintenant);
  const enRetard = rappels.filter((r) => r.enRetard).length;
  const lienSansDate =
    sansDate > 0 ? (
      <Link href="/appels?rappels=1" className="decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
        <span className="font-mono">{sansDate}</span> rappel{sansDate > 1 ? 's' : ''} convenu{sansDate > 1 ? 's' : ''} sans date
      </Link>
    ) : null;

  if (rappels.length === 0) {
    return <p className="pt-3.5 text-sm text-encre-3">Aucun rappel daté pour aujourd’hui · {lienSansDate}</p>;
  }

  return (
    <section aria-labelledby="titre-rappels" className="grid grid-cols-1 pt-5">
      <TitreSection
        id="titre-rappels"
        compte={rappels.length}
        action={
          <LienAction ton="discret" href="/appels?rappels=1" className="-mr-1.5">
            Tous les rappels à faire
          </LienAction>
        }
      >
        À rappeler aujourd’hui
      </TitreSection>
      {enRetard > 0 || sansDate > 0 ? (
        <p className="pt-2 text-sm text-encre-3">
          {enRetard > 0 ? (
            <>
              dont <span className="font-mono">{enRetard}</span> en retard
            </>
          ) : null}
          {enRetard > 0 && lienSansDate ? ' · ' : null}
          {lienSansDate ? <>et {lienSansDate}</> : null}
        </p>
      ) : null}
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
