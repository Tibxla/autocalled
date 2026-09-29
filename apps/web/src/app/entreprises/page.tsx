import type { Metadata } from 'next';
import { NavigationListe } from '@/components/clavier';
import { Cellule, CelluleEnTete, EnTeteTable, EtatVide, LienLigne, LigneTable, Page, TableDense } from '@/components/ui';
import { listerEntreprises, prospectsAutorisesParEntreprise } from '@/lib/donnees';
import { CreationEntreprise } from './formulaire-creation';

export const metadata: Metadata = { title: 'Entreprises' };

const COLONNES = 'minmax(10rem,14rem) minmax(0,1fr) 7rem 6rem 5rem 11rem';

/** Ce qui manque en premier pour que Mina puisse appeler, dans l'ordre du travail ; null si l'entreprise est prête. */
function premierManque(e: { offre: string; nombreScripts: number; nombreProspects: number }, appelables: number): string | null {
  if (!e.offre.trim()) return 'Offre à écrire';
  if (e.nombreScripts === 0) return 'Aucun script';
  if (e.nombreProspects === 0) return 'Aucun prospect';
  if (appelables === 0) return 'Aucun numéro autorisé';
  return null;
}

export default async function PageEntreprises() {
  const [liste, autorises] = await Promise.all([listerEntreprises(), prospectsAutorisesParEntreprise()]);

  return (
    <Page largeur="lecture">
      <CreationEntreprise compte={liste.length} />

      {liste.length === 0 ? (
        <EtatVide titre="Aucune entreprise pour l’instant.">
          Crée l’entreprise, décris son offre, écris un script, puis importe ses prospects : c’est ce que Mina dira au téléphone.
        </EtatVide>
      ) : (
        <NavigationListe memoriser="entreprises">
          <TableDense libelle="Entreprises" colonnes={COLONNES} className="mt-2">
            <EnTeteTable>
              <CelluleEnTete>Entreprise</CelluleEnTete>
              <CelluleEnTete masqueeMobile>Offre</CelluleEnTete>
              <CelluleEnTete align="droite">Appelables</CelluleEnTete>
              <CelluleEnTete align="droite">Objections</CelluleEnTete>
              <CelluleEnTete align="droite">Scripts</CelluleEnTete>
              <CelluleEnTete>État</CelluleEnTete>
            </EnTeteTable>
            <div role="rowgroup">
              {liste.map((e) => {
                const appelables = autorises.get(e.id) ?? 0;
                const manque = premierManque(e, appelables);
                return (
                  <LigneTable key={e.id}>
                    <Cellule tronquee titre={e.nom} className="font-medium max-sm:order-1 max-sm:flex-1">
                      <LienLigne href={`/entreprises/${e.slug}`}>{e.nom}</LienLigne>
                    </Cellule>
                    <Cellule tronquee titre={e.offre || undefined} attenuee masqueeMobile>
                      {e.offre.trim() || 'Offre à écrire'}
                    </Cellule>
                    <Cellule align="droite" mono className="max-sm:order-3">
                      {appelables}/{e.nombreProspects}
                      <span className="sm:hidden"> appelables</span>
                    </Cellule>
                    <Cellule align="droite" mono className="max-sm:order-3">
                      {e.nombreObjections}
                      <span className="sm:hidden"> {e.nombreObjections > 1 ? 'objections' : 'objection'}</span>
                    </Cellule>
                    <Cellule align="droite" mono className="max-sm:order-3">
                      {e.nombreScripts}
                      <span className="sm:hidden"> {e.nombreScripts > 1 ? 'scripts' : 'script'}</span>
                    </Cellule>
                    <Cellule tronquee className={`max-sm:order-1 ${manque ? 'text-encre-3' : 'text-encre-2'}`}>
                      {manque ?? 'Prête'}
                    </Cellule>
                    {/* Sous 640 px : nom et état sur la première rangée, les comptes sur la seconde. */}
                    <span aria-hidden="true" className="h-0 basis-full max-sm:order-2 sm:hidden" />
                  </LigneTable>
                );
              })}
            </div>
          </TableDense>
        </NavigationListe>
      )}
    </Page>
  );
}
