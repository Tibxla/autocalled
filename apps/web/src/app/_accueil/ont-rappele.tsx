import { etatAppel, heure } from '@/components/format-appel';
import { Cellule, CelluleEnTete, EnTeteTable, LienAction, LienLigne, LigneTable, TableDense, TitreSection } from '@/components/ui';
import type { AppelDuJour } from '@/lib/accueil';

/**
 * « Ont rappelé aujourd'hui » : les appels entrants du jour, ceux d'un prospect qui a rappelé le téléphone passerelle
 * et que l'assistante a décroché, du plus récent au plus ancien. Chaque ligne mène à l'appel et à son bilan. Tirée des
 * appels du jour déjà lus par la page, sans requête de plus. Personne n'a rappelé : la section se tait.
 */

const COLONNES = '4rem minmax(0,1fr) minmax(0,12rem) minmax(0,1fr)';

const TONS = { antenne: 'text-antenne', alerte: 'text-alerte', encre: 'text-encre', 'encre-2': 'text-encre-2', 'encre-3': 'text-encre-3' } as const;

export function OntRappele({ appels, maintenant }: { appels: AppelDuJour[]; maintenant: string }) {
  const entrants = appels.filter((a) => a.sens === 'entrant' && a.ligne !== 'simulation');
  if (entrants.length === 0) return null;
  const quand = new Date(maintenant);

  return (
    <section aria-labelledby="titre-ont-rappele" className="grid grid-cols-1 pt-5">
      <TitreSection
        id="titre-ont-rappele"
        action={
          <LienAction ton="discret" href="/appels?sens=entrant" aria-label="Tous les appels entrants" className="-mr-1.5 shrink-0">
            <span className="sm:hidden">Tous les entrants</span>
            <span className="max-sm:hidden">Tous les appels entrants</span>
          </LienAction>
        }
      >
        Ont rappelé aujourd’hui
        <span className="ml-2.5 font-mono text-md font-normal text-encre-3">{entrants.length}</span>
      </TitreSection>
      <TableDense libelle="Ont rappelé aujourd’hui" colonnes={COLONNES} className="pt-1">
        <EnTeteTable>
          <CelluleEnTete>Heure</CelluleEnTete>
          <CelluleEnTete>Prospect</CelluleEnTete>
          <CelluleEnTete masqueeMobile>Entreprise</CelluleEnTete>
          <CelluleEnTete masqueeMobile>Issue</CelluleEnTete>
        </EnTeteTable>
        <div role="rowgroup">
          {entrants.map((a) => {
            // Un appel encore ouvert : la bande du haut le suit en direct, ici il est seulement « en cours ».
            const etat =
              a.statut === 'en-cours'
                ? { libelle: 'En cours', ton: 'encre-2' as const }
                : etatAppel({ ...a, conversationId: a.conversation ? 'oui' : null }, { libellePerso: a.libellePerso, maintenant: quand });
            return (
              <LigneTable key={a.id}>
                <Cellule mono className="max-sm:order-1 max-sm:w-11">
                  {heure(a.debutLe)}
                </Cellule>
                <Cellule tronquee titre={a.societe ? `${a.prospect} · ${a.societe}` : a.prospect} className="max-sm:order-2 max-sm:flex-1">
                  <LienLigne href={`/appels/${a.id}?depuis=%2F`}>
                    <span className="font-medium">{a.prospect}</span>
                    {a.societe ? <span className="text-encre-3"> · {a.societe}</span> : null}
                  </LienLigne>
                </Cellule>
                <Cellule tronquee titre={a.entreprise} masqueeMobile className="text-encre-2">
                  {a.entreprise}
                </Cellule>
                {/* Sous 640 px, l'issue passe sous le nom, alignée sur lui. */}
                <Cellule tronquee className={`max-sm:order-3 max-sm:basis-full max-sm:pl-14 max-sm:text-sm ${TONS[etat.ton]}`}>
                  {etat.libelle}
                </Cellule>
              </LigneTable>
            );
          })}
        </div>
      </TableDense>
    </section>
  );
}
