'use client';

import type { IssueSysteme } from '@autocalled/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavigationListe } from '@/components/clavier';
import { etatAppel, issueEffective, type TonEtat } from '@/components/format-appel';
import {
  Cellule,
  CelluleEnTete,
  Duree,
  EnTeteTable,
  EtatVide,
  Filtre,
  Filtres,
  GlypheEtape,
  Heure,
  LienLigne,
  LigneTable,
  Recherche,
  TableDense,
  Action,
} from '@/components/ui';

/**
 * La file d'une campagne : chaque prospect dans l'ordre d'appel, avec son appel s'il est parti. Filtres et
 * recherche restent dans la page (la liste est déjà chargée en entier) ; l'URL garde le filtre par
 * window.history.replaceState, sans relancer le rendu serveur que la régie rafraîchit déjà.
 */

export interface EntreeFile {
  rang: number;
  prospectId: string;
  nom: string;
  societe: string | null;
  etat: 'a-appeler' | 'en-appel' | 'appelee' | 'sautee';
  suivant: boolean;
  appel: {
    id: string;
    ligne: string;
    statut: string;
    issue: string | null;
    issueSysteme: IssueSysteme | null;
    erreur: string | null;
    conversation: boolean;
    debutLe: string;
    dureeSecondes: number | null;
    etape: number | null;
    libellePerso: string | null;
  } | null;
}

type Categorie = 'a-appeler' | 'en-appel' | 'rendez-vous-pris' | 'rappel-convenu' | 'refus' | 'non-abouti' | 'autres' | 'sautes';

const FILTRES: { cle: Categorie; libelle: string }[] = [
  { cle: 'a-appeler', libelle: 'À appeler' },
  { cle: 'en-appel', libelle: 'En appel' },
  { cle: 'rendez-vous-pris', libelle: 'Rendez-vous pris' },
  { cle: 'rappel-convenu', libelle: 'Rappel convenu' },
  { cle: 'refus', libelle: 'Refus' },
  { cle: 'non-abouti', libelle: 'Non abouti' },
  { cle: 'autres', libelle: 'Autres' },
  { cle: 'sautes', libelle: 'Sautés' },
];

const CLES = new Set<string>(FILTRES.map((f) => f.cle));

function categorie(e: EntreeFile): Categorie {
  if (e.etat === 'a-appeler') return 'a-appeler';
  if (e.etat === 'en-appel') return 'en-appel';
  if (e.etat === 'sautee') return 'sautes';
  const issue = e.appel ? issueEffective(e.appel) : null;
  if (issue === 'rendez-vous-pris' || issue === 'rappel-convenu' || issue === 'refus' || issue === 'non-abouti') return issue;
  return 'autres';
}

const TONS: Record<TonEtat, string> = {
  antenne: 'text-antenne',
  alerte: 'text-alerte',
  encre: 'text-encre',
  'encre-2': 'text-encre-2',
  'encre-3': 'text-encre-3',
};

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function Issue({ e }: { e: EntreeFile }) {
  if (e.etat === 'a-appeler') {
    return e.suivant ? <span className="text-encre-2">Suivant</span> : <span className="text-encre-3">À appeler</span>;
  }
  if (e.etat === 'sautee') return <span className="text-encre-3">Sauté : numéro non autorisé</span>;
  if (e.etat === 'en-appel' && (!e.appel || e.appel.statut === 'en-cours')) return <span>En appel</span>;
  if (!e.appel) return <span className="text-encre-3">Sans appel</span>;
  const etat = etatAppel(e.appel, { libellePerso: e.appel.libellePerso });
  return (
    <span className={TONS[etat.ton]} title={etat.detail}>
      {etat.libelle}
    </span>
  );
}

function Glyphe({ e, nombreEtapes }: { e: EntreeFile; nombreEtapes: number | null }) {
  if (e.etat === 'en-appel') return <GlypheEtape etat="vivant" />;
  const a = e.appel;
  if (!a) return null;
  const etat = a.statut === 'echec' ? 'echec' : a.statut === 'traitement' ? 'analyse' : a.etape === null ? 'sans-bilan' : 'bilan';
  return <GlypheEtape etat={etat} etape={a.etape} nombre={nombreEtapes} rendezVous={issueEffective(a) === 'rendez-vous-pris'} />;
}

export function File({
  entrees,
  nombreEtapes,
  slug,
  campagneId,
  filtreInitial,
}: {
  entrees: EntreeFile[];
  nombreEtapes: number | null;
  slug: string;
  /** Ajouté aux liens des appels (?depuis=) : la fiche d'appel revient à la campagne. */
  campagneId?: string;
  filtreInitial?: string | undefined;
}) {
  const depuis = campagneId ? `?depuis=${encodeURIComponent(`/campagnes/${campagneId}`)}` : '';
  const [filtre, setFiltre] = useState<Categorie | null>(filtreInitial && CLES.has(filtreInitial) ? (filtreInitial as Categorie) : null);
  const [texte, setTexte] = useState('');
  // Remonter la recherche la vide : elle garde sa saisie en propre.
  const [cleRecherche, setCleRecherche] = useState(0);

  const comptes = useMemo(() => {
    const c = new Map<Categorie, number>();
    for (const e of entrees) c.set(categorie(e), (c.get(categorie(e)) ?? 0) + 1);
    return c;
  }, [entrees]);

  const recherche = sansAccents(texte.trim());
  const visibles = entrees.filter(
    (e) =>
      (filtre === null || categorie(e) === filtre) &&
      (recherche === '' || sansAccents(`${e.nom} ${e.societe ?? ''}`).includes(recherche)),
  );

  const choisir = (suivant: Categorie | null) => {
    setFiltre(suivant);
    const url = new URL(window.location.href);
    if (suivant) url.searchParams.set('file', suivant);
    else url.searchParams.delete('file');
    window.history.replaceState(null, '', url);
  };

  // L'entrée en appel revient à l'écran quand elle change, si l'opérateur regarde déjà la file.
  const table = useRef<HTMLDivElement>(null);
  const vivante = entrees.find((e) => e.etat === 'en-appel')?.prospectId ?? null;
  const precedente = useRef(vivante);
  useEffect(() => {
    if (precedente.current === vivante) return;
    precedente.current = vivante;
    if (!vivante || !table.current) return;
    const cadre = table.current.getBoundingClientRect();
    if (cadre.bottom < 0 || cadre.top > window.innerHeight) return;
    document.getElementById(`file-${vivante}`)?.scrollIntoView({ block: 'nearest' });
  }, [vivante]);

  return (
    <div className="grid grid-cols-1 gap-3 pt-3">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <Filtres libelle="Filtrer la file">
          <Filtre actif={filtre === null} compte={entrees.length} onClick={() => choisir(null)}>
            Tous
          </Filtre>
          {FILTRES.map((f) => (
            <Filtre key={f.cle} actif={filtre === f.cle} compte={comptes.get(f.cle) ?? 0} onClick={() => choisir(f.cle)}>
              {f.libelle}
            </Filtre>
          ))}
        </Filtres>
        <Recherche key={cleRecherche} placeholder="Chercher un prospect" libelle="Chercher dans la file" instantane={setTexte} />
      </div>

      {visibles.length === 0 ? (
        <EtatVide
          forme="filtre"
          titre="Aucun prospect ne correspond."
          action={
            <Action
              ton="discret"
              onClick={() => {
                choisir(null);
                setTexte('');
                setCleRecherche((c) => c + 1);
              }}
            >
              Voir toute la file
            </Action>
          }
        >
          {texte ? 'Vide la recherche (Échap dans le champ) ou change de filtre.' : null}
        </EtatVide>
      ) : (
        <NavigationListe>
          <div ref={table}>
            <TableDense libelle="File de la campagne" colonnes="2.5rem minmax(0,1fr) 3.5rem 3.5rem 4.5rem minmax(9rem,16rem)">
              <EnTeteTable>
                <CelluleEnTete>Rang</CelluleEnTete>
                <CelluleEnTete>Prospect</CelluleEnTete>
                <CelluleEnTete masqueeMobile>Heure</CelluleEnTete>
                <CelluleEnTete align="droite" masqueeMobile>
                  Durée
                </CelluleEnTete>
                <CelluleEnTete masqueeMobile>Étape</CelluleEnTete>
                <CelluleEnTete>Issue</CelluleEnTete>
              </EnTeteTable>
              <div role="rowgroup">
                {visibles.map((e) => (
                  <LigneTable
                    key={e.prospectId}
                    id={`file-${e.prospectId}`}
                    etat={e.etat === 'en-appel' ? 'vivante' : e.etat === 'sautee' ? 'attenuee' : 'normale'}
                  >
                    <Cellule mono className="max-sm:order-1 max-sm:w-7">
                      {e.rang}
                    </Cellule>
                    <Cellule tronquee titre={e.societe ? `${e.nom} · ${e.societe}` : e.nom} className="max-sm:order-2 max-sm:flex-1">
                      <LienLigne href={e.appel ? `/appels/${e.appel.id}${depuis}` : `/entreprises/${slug}/prospects/${e.prospectId}`}>
                        <span className="font-medium">{e.nom}</span>
                        {e.societe ? <span className="text-encre-3"> · {e.societe}</span> : null}
                      </LienLigne>
                    </Cellule>
                    {/* Sous 640 px, heure et durée restent sur la ligne du nom ; l'issue passe dessous. */}
                    <Cellule mono className="max-sm:order-3">
                      {e.appel ? <Heure date={e.appel.debutLe} /> : null}
                    </Cellule>
                    <Cellule mono align="droite" className="max-sm:order-4 max-sm:ml-3">
                      <Duree secondes={e.appel?.dureeSecondes} />
                    </Cellule>
                    <Cellule masqueeMobile className="flex items-center gap-2">
                      <Glyphe e={e} nombreEtapes={nombreEtapes} />
                      {e.appel?.etape != null && nombreEtapes ? (
                        <span className="font-mono text-xs text-encre-3">
                          {e.appel.etape}/{nombreEtapes}
                        </span>
                      ) : null}
                    </Cellule>
                    <Cellule etat tronquee className="max-sm:order-5 max-sm:basis-full max-sm:pl-10 max-sm:text-sm">
                      <Issue e={e} />
                    </Cellule>
                  </LigneTable>
                ))}
              </div>
            </TableDense>
          </div>
        </NavigationListe>
      )}
    </div>
  );
}
