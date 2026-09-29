'use client';

import type { Autorisation } from '@autocalled/domain';
import { useMemo, useState } from 'react';
import { NavigationListe } from '@/components/clavier';
import { numeroMasque } from '@/components/format-appel';
import { PastilleAutorisation } from '@/components/pastille-autorisation';
import {
  Action,
  Cellule,
  CelluleEnTete,
  EnTeteTable,
  EtatVide,
  Filtre,
  Filtres,
  LienLigne,
  LigneTable,
  Message,
  Recherche,
  TableDense,
  TitreSection,
} from '@/components/ui';
import { FormulaireImport } from './formulaire-import';

/**
 * Les prospects d'une entreprise : liste pleine largeur, filtres et recherche dans la page (tout est chargé),
 * import en volet au-dessus de la liste (I). Le filtre se garde dans l'URL par window.history.replaceState,
 * sans relancer le rendu serveur.
 */

export interface LigneProspect {
  id: string;
  nom: string;
  /** « Gérante, Gîte des Aravis ». */
  detail: string;
  /** Numéro lisible, formaté par le serveur ; affiché masqué, en clair au survol. */
  numero: string;
  /** Chiffres du numéro (national et international), pour la recherche seulement. */
  chiffres: string;
  autorisation: Autorisation | undefined;
  /** `vivant` : l'appel que la ligne téléphone porte en ce moment. */
  dernier: { date: string; libelle: string; vivant?: boolean } | null;
  /** Rappel convenu à faire : quand (en clair, null s'il n'est pas daté), ce qu'a dit le prospect, s'il est en retard. */
  rappel: { quand: string | null; texte: string | null; enRetard: boolean } | null;
}

type CleFiltre = 'autorises' | 'revoques' | 'sans-consentement' | 'invalides' | 'rappels';

const FILTRES: { cle: CleFiltre; libelle: string }[] = [
  { cle: 'autorises', libelle: 'Autorisés' },
  { cle: 'revoques', libelle: 'Révoqués' },
  { cle: 'sans-consentement', libelle: 'Sans consentement' },
  { cle: 'invalides', libelle: 'Numéro invalide' },
  { cle: 'rappels', libelle: 'Rappel à faire' },
];
const CLES = new Set<string>(FILTRES.map((f) => f.cle));

function dansFiltre(p: LigneProspect, cle: CleFiltre): boolean {
  const a = p.autorisation;
  switch (cle) {
    case 'autorises':
      return Boolean(a?.autorise);
    case 'revoques':
      return a?.autorise === false && a.raison === 'consentement-revoque';
    case 'sans-consentement':
      return !a || (a.autorise === false && a.raison === 'aucun-consentement');
    case 'invalides':
      return a?.autorise === false && a.raison === 'numero-invalide';
    case 'rappels':
      return p.rappel !== null;
  }
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function correspond(p: LigneProspect, recherche: string): boolean {
  if (!recherche) return true;
  if (sansAccents(`${p.nom} ${p.detail}`).includes(recherche)) return true;
  const chiffres = recherche.replace(/\D/g, '');
  return chiffres.length >= 2 && chiffres.length === recherche.replace(/[\s.+-]/g, '').length && p.chiffres.includes(chiffres);
}

export function ListeProspects({
  slug,
  entrepriseId,
  texteConsentement,
  prospects,
  filtreInitial,
  importOuvert = false,
}: {
  slug: string;
  entrepriseId: string;
  texteConsentement: string | null;
  prospects: LigneProspect[];
  filtreInitial?: string | undefined;
  importOuvert?: boolean;
}) {
  const vide = prospects.length === 0;
  const [volet, setVolet] = useState(importOuvert || vide);
  const [ouvertParGeste, setOuvertParGeste] = useState(false);
  const [filtre, setFiltre] = useState<CleFiltre | null>(filtreInitial && CLES.has(filtreInitial) ? (filtreInitial as CleFiltre) : null);
  const [texte, setTexte] = useState('');
  const [cleRecherche, setCleRecherche] = useState(0);

  const comptes = useMemo(() => new Map(FILTRES.map((f) => [f.cle, prospects.filter((p) => dansFiltre(p, f.cle)).length])), [prospects]);
  const recherche = sansAccents(texte.trim());
  const visibles = prospects.filter((p) => (filtre === null || dansFiltre(p, filtre)) && correspond(p, recherche));

  const choisir = (suivant: CleFiltre | null) => {
    setFiltre(suivant);
    const url = new URL(window.location.href);
    if (suivant) url.searchParams.set('filtre', suivant);
    else url.searchParams.delete('filtre');
    window.history.replaceState(null, '', url);
  };

  const effacer = () => {
    choisir(null);
    setTexte('');
    setCleRecherche((c) => c + 1);
  };

  const basculerVolet = () => {
    setOuvertParGeste(!volet);
    setVolet(!volet);
  };

  return (
    <div className="grid grid-cols-1">
      <TitreSection
        compte={prospects.length}
        action={
          vide ? undefined : (
            <Action touche="I" raccourci="i" aria-expanded={volet} aria-controls="volet-import" onClick={basculerVolet}>
              {volet ? 'Fermer l’import' : 'Importer des fiches'}
            </Action>
          )
        }
      >
        Prospects
      </TitreSection>

      {vide ? (
        <EtatVide titre="Aucun prospect.">Importe des fiches Markdown : un fichier par prospect.</EtatVide>
      ) : null}

      {volet ? (
        <section id="volet-import" aria-label="Importer des fiches prospect" className="border-b border-filet py-6">
          {texteConsentement ? (
            <FormulaireImport entrepriseId={entrepriseId} texteConsentement={texteConsentement} focusAuMontage={ouvertParGeste} />
          ) : (
            <Message ton="alerte">Aucun texte de consentement en base : lance les migrations.</Message>
          )}
        </section>
      ) : null}

      {vide ? null : (
        <div className="grid grid-cols-1 gap-3 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <Filtres libelle="Filtrer les prospects">
              <Filtre actif={filtre === null} compte={prospects.length} onClick={() => choisir(null)}>
                Tous
              </Filtre>
              {FILTRES.map((f) => (
                <Filtre key={f.cle} actif={filtre === f.cle} compte={comptes.get(f.cle) ?? 0} onClick={() => choisir(f.cle)}>
                  {f.libelle}
                </Filtre>
              ))}
            </Filtres>
            <Recherche
              key={cleRecherche}
              placeholder="Chercher un nom, une société ou un numéro"
              libelle="Chercher un prospect"
              instantane={setTexte}
              className="w-full sm:w-[340px]"
            />
          </div>

          {visibles.length === 0 ? (
            <EtatVide
              forme="filtre"
              titre="Aucun prospect ne correspond."
              action={
                <Action ton="discret" onClick={effacer}>
                  Effacer la recherche et le filtre
                </Action>
              }
            />
          ) : (
            <NavigationListe memoriser="prospects">
              <TableDense libelle="Prospects" colonnes="minmax(0,1.6fr) 9rem minmax(0,1fr) 9.5rem">
                <EnTeteTable>
                  <CelluleEnTete>Prospect</CelluleEnTete>
                  <CelluleEnTete masqueeMobile>Numéro</CelluleEnTete>
                  <CelluleEnTete>Dernier appel</CelluleEnTete>
                  <CelluleEnTete align="droite">Autorisation</CelluleEnTete>
                </EnTeteTable>
                <div role="rowgroup">
                  {visibles.map((p) => (
                    <LigneTable key={p.id} etat={p.dernier?.vivant ? 'vivante' : p.autorisation?.autorise ? 'normale' : 'attenuee'}>
                      <Cellule tronquee titre={p.detail ? `${p.nom} · ${p.detail}` : p.nom} className="max-sm:order-1 max-sm:flex-1">
                        <LienLigne href={`/entreprises/${slug}/prospects/${p.id}`}>
                          <span className="font-medium">{p.nom}</span>
                          {p.detail ? <span className="text-encre-3 max-sm:hidden"> · {p.detail}</span> : null}
                        </LienLigne>
                      </Cellule>
                      <Cellule mono masqueeMobile>
                        <span title={p.numero}>{numeroMasque(p.numero)}</span>
                      </Cellule>
                      <Cellule
                        tronquee
                        {...(p.rappel?.quand && p.rappel.texte ? { titre: `« ${p.rappel.texte} »` } : {})}
                        className="text-encre-3 max-sm:order-3 max-sm:basis-full max-sm:text-sm"
                      >
                        {p.detail ? <span className="sm:hidden">{p.detail}{p.dernier || p.rappel ? ' · ' : ''}</span> : null}
                        {p.dernier?.vivant ? (
                          <span className="text-antenne">En cours</span>
                        ) : p.rappel ? (
                          p.rappel.quand ? (
                            <span className={p.rappel.enRetard ? 'text-encre' : 'text-encre-2'}>
                              {p.rappel.enRetard ? <span className="text-alerte">Rappel en retard</span> : 'Rappel'} : {p.rappel.quand}
                            </span>
                          ) : (
                            <span className="text-encre-2">Rappel convenu : {p.rappel.texte ? `« ${p.rappel.texte} »` : 'moment non précisé'}</span>
                          )
                        ) : p.dernier ? (
                          <>
                            <span className="font-mono text-xs">{p.dernier.date}</span> · {p.dernier.libelle}
                          </>
                        ) : null}
                      </Cellule>
                      <Cellule align="droite" className="max-sm:order-2">
                        <PastilleAutorisation autorisation={p.autorisation} />
                      </Cellule>
                    </LigneTable>
                  ))}
                </div>
              </TableDense>
            </NavigationListe>
          )}
        </div>
      )}
    </div>
  );
}
