'use client';

import type { Autorisation } from '@autocalled/domain';
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { NavigationListe } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
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
import { DetailEffacement } from './[id]/gestes-prospect';
import { type RapportEffacement, archiverProspect, effacerLaPersonne, inventaireEffacement, reactiverProspect } from './actions';
import { FormulaireImport } from './formulaire-import';
import { RapportEffacementMessage } from './rapport-effacement';

/**
 * Les prospects d'une entreprise : liste pleine largeur, filtres et recherche dans la page (tout est chargé),
 * import en volet au-dessus de la liste (I). Le filtre se garde dans l'URL par window.history.replaceState,
 * sans relancer le rendu serveur. Les archivés (ADR 0013) ne sont que sous leur filtre. En bout de ligne, deux
 * gestes discrets : Archiver (ou Réactiver), immédiat et réversible, et Effacer, dont la confirmation s'ouvre sous la
 * ligne avec ce que le serveur compte à l'instant. Sous 640 px, ces gestes quittent les lignes : la fiche les porte.
 *
 * Le retour d'un geste s'écrit dans sa ligne, qui reste à sa place, atténuée, même quand le prospect ne relève plus
 * du filtre (un archivé sous « Tous »), jusqu'au prochain changement de filtre ou de recherche ; Annuler défait
 * l'archivage ou la réactivation. Une personne effacée depuis la liste laisse sa ligne, avec le compte rendu. Un
 * envoi ne désactive que sa ligne.
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
  /** Archivé : hors des listes par défaut, jamais appelé tant qu'il l'est. */
  archive: boolean;
}

type CleFiltre = 'autorises' | 'revoques' | 'sans-consentement' | 'invalides' | 'rappels' | 'archives';

const FILTRES: { cle: CleFiltre; libelle: string }[] = [
  { cle: 'autorises', libelle: 'Autorisés' },
  { cle: 'revoques', libelle: 'Révoqués' },
  { cle: 'sans-consentement', libelle: 'Sans consentement' },
  { cle: 'invalides', libelle: 'Numéro invalide' },
  { cle: 'rappels', libelle: 'Rappel à faire' },
  { cle: 'archives', libelle: 'Archivés' },
];
const CLES = new Set<string>(FILTRES.map((f) => f.cle));

/** « Tous » et les filtres d'autorisation ne montrent que les prospects actifs ; « Archivés », les autres. */
function dansFiltre(p: LigneProspect, cle: CleFiltre | null): boolean {
  if (cle === 'archives') return p.archive;
  if (p.archive) return false;
  const a = p.autorisation;
  switch (cle) {
    case null:
      return true;
    case 'autorises':
      return Boolean(a?.autorise);
    case 'revoques':
      // Révoqué ou effacé : la personne a demandé à ne plus être appelée.
      return a?.autorise === false && (a.raison === 'consentement-revoque' || a.raison === 'numero-efface');
    case 'sans-consentement':
      return !a || (a.autorise === false && a.raison === 'aucun-consentement');
    case 'invalides':
      return a?.autorise === false && (a.raison === 'numero-invalide' || a.raison === 'opposition-illisible');
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
  rapportInitial = null,
}: {
  slug: string;
  entrepriseId: string;
  texteConsentement: string | null;
  prospects: LigneProspect[];
  filtreInitial?: string | undefined;
  importOuvert?: boolean;
  /** Le compte rendu d'un effacement fait depuis la fiche (paramètre `efface` de l'adresse). */
  rapportInitial?: RapportEffacement | null;
}) {
  const vide = prospects.length === 0;
  const [volet, setVolet] = useState(importOuvert || vide);
  const [ouvertParGeste, setOuvertParGeste] = useState(false);
  const [filtre, setFiltre] = useState<CleFiltre | null>(filtreInitial && CLES.has(filtreInitial) ? (filtreInitial as CleFiltre) : null);
  const [texte, setTexte] = useState('');
  const [cleRecherche, setCleRecherche] = useState(0);

  // Retours de geste, écrits dans la ligne : elle reste affichée tant qu'elle en porte un.
  const [retours, setRetours] = useState<Map<string, Retour>>(() => new Map());
  const [derniereAnnonce, setDerniereAnnonce] = useState('');
  const ecrire = (id: string, retour: Retour | null) => {
    setRetours((r) => {
      const suite = new Map(r);
      if (retour) suite.set(id, retour);
      else suite.delete(id);
      return suite;
    });
    if (retour) setDerniereAnnonce(retour.texte);
  };

  const comptes = useMemo(() => new Map(FILTRES.map((f) => [f.cle, prospects.filter((p) => dansFiltre(p, f.cle)).length])), [prospects]);
  const actifs = prospects.filter((p) => !p.archive).length;
  const recherche = sansAccents(texte.trim());
  // Une personne effacée depuis la liste n'est plus dans `prospects` : sa ligne revient à sa place d'avant.
  const lignes = [...prospects];
  for (const [id, r] of retours) {
    if (r.efface && !prospects.some((p) => p.id === id)) lignes.splice(Math.min(r.efface.rang, lignes.length), 0, r.efface.p);
  }
  const visibles = lignes.filter((p) => retours.has(p.id) || (dansFiltre(p, filtre) && correspond(p, recherche)));

  // Gestes de ligne : archiver ou réactiver (immédiat), effacer (confirmé sous la ligne).
  const [, demarrer] = useTransition();
  const [enCoursPour, setEnCoursPour] = useState<string | null>(null);
  const confirmationEffacement = useConfirmation();
  const [aEffacer, setAEffacer] = useState<{ p: LigneProspect; detail: { efface: string[]; reste: string[]; obstacle: string | null } | null } | null>(null);
  const [erreurEffacement, setErreurEffacement] = useState<string | null>(null);
  const [inventaireEnCours, setInventaireEnCours] = useState(false);

  // Le compte rendu venu de la fiche ne se rejoue pas au rechargement : l'adresse le perd, la page le garde.
  useEffect(() => {
    if (!rapportInitial) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('efface');
    window.history.replaceState(null, '', url);
  }, [rapportInitial]);

  const fermerEffacement = () => {
    setAEffacer(null);
    setErreurEffacement(null);
    confirmationEffacement.fermer();
  };

  const basculerArchive = (p: LigneProspect, archive: boolean) => {
    setEnCoursPour(p.id);
    demarrer(async () => {
      try {
        if (archive) {
          const r = await reactiverProspect(entrepriseId, p.id);
          ecrire(p.id, r.ok ? { texte: 'Réactivé : de nouveau appelable.', defaire: 'archiver' } : { texte: r.raison, alerte: true });
        } else {
          const r = await archiverProspect(entrepriseId, p.id);
          ecrire(
            p.id,
            r.ok
              ? {
                  texte: `Archivé${r.retireDe ? `, retiré de ${r.retireDe > 1 ? `${r.retireDe} files` : 'la file de sa campagne'}` : ' : plus proposé pour un appel'}.`,
                  defaire: 'reactiver',
                }
              : { texte: r.raison, alerte: true },
          );
        }
      } catch {
        ecrire(p.id, { texte: 'Le geste n’a pas abouti : relis la page et réessaie.', alerte: true });
      } finally {
        setEnCoursPour(null);
      }
    });
  };

  const ouvrirEffacement = (p: LigneProspect, declencheur: HTMLElement) => {
    setAEffacer({ p, detail: null });
    setErreurEffacement(null);
    confirmationEffacement.ouvrir(declencheur);
    setInventaireEnCours(true);
    demarrer(async () => {
      try {
        const r = await inventaireEffacement(entrepriseId, p.id);
        if (!r.ok) return setErreurEffacement(r.raison);
        setAEffacer({ p, detail: { efface: r.efface, reste: r.reste, obstacle: r.obstacle } });
      } catch {
        setErreurEffacement('L’inventaire n’a pas pu être lu : ferme et réessaie.');
      } finally {
        setInventaireEnCours(false);
      }
    });
  };

  const effacerPersonne = (p: LigneProspect) => {
    setEnCoursPour(p.id);
    const rang = lignes.findIndex((l) => l.id === p.id);
    demarrer(async () => {
      setErreurEffacement(null);
      try {
        const r = await effacerLaPersonne(entrepriseId, p.id);
        if (!r.ok) return setErreurEffacement(r.raison);
        ecrire(p.id, { texte: `${p.nom} est effacé.`, efface: { p, rang: Math.max(rang, 0), rapport: r.rapport } });
        fermerEffacement();
      } catch {
        setErreurEffacement('L’effacement n’a pas abouti : relis la page avant de réessayer.');
      } finally {
        setEnCoursPour(null);
      }
    });
  };

  // Changer de filtre ou de recherche relit la liste : les lignes gardées pour leur retour s'en vont.
  const oublierRetours = () => {
    if (retours.size) setRetours(new Map());
  };

  const choisir = (suivant: CleFiltre | null) => {
    oublierRetours();
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

  // Recherche : oublier les retours à la première frappe qui change la liste, pas à chaque rendu.
  const texteVu = useRef(texte);
  const chercher = (t: string) => {
    if (t.trim() !== texteVu.current.trim()) oublierRetours();
    texteVu.current = t;
    setTexte(t);
  };

  return (
    <div className="grid grid-cols-1">
      <TitreSection
        compte={actifs}
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

      {/* Effacement fait depuis la fiche : la ligne n'existe plus, le compte rendu vient en tête. */}
      {rapportInitial ? (
        <div className="pt-4">
          <RapportEffacementMessage rapport={rapportInitial} />
        </div>
      ) : null}

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
          {/* Sous 640 px, la recherche en tête, pleine largeur, puis la rangée des filtres. */}
          <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-8">
            <Filtres libelle="Filtrer les prospects">
              <Filtre actif={filtre === null} compte={actifs} onClick={() => choisir(null)}>
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
              instantane={chercher}
              className="w-full max-sm:order-first sm:w-[340px]"
            />
          </div>

          {/* Les retours s'écrivent dans les lignes ; cette région les annonce aux lecteurs d'écran. */}
          <p role="status" className="sr-only">
            {derniereAnnonce}
          </p>

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
              <TableDense libelle="Prospects" colonnes="minmax(0,1.6fr) 9rem minmax(0,1fr) 9.5rem 10rem">
                <EnTeteTable>
                  <CelluleEnTete>Prospect</CelluleEnTete>
                  <CelluleEnTete masqueeMobile>Numéro</CelluleEnTete>
                  <CelluleEnTete>Dernier appel</CelluleEnTete>
                  <CelluleEnTete align="droite">Autorisation</CelluleEnTete>
                  <CelluleEnTete masqueeMobile>
                    <span className="sr-only">Gestes</span>
                  </CelluleEnTete>
                </EnTeteTable>
                <div role="rowgroup">
                  {visibles.map((p) => {
                    const retour = retours.get(p.id);
                    if (retour?.efface) {
                      return (
                        <LigneTable key={p.id} etat="attenuee" className="sm:h-auto sm:py-2">
                          <Cellule className="grid gap-2 max-sm:basis-full sm:col-span-full">
                            <span className="font-medium">{p.nom}</span>
                            <RapportEffacementMessage rapport={retour.efface.rapport} />
                          </Cellule>
                        </LigneTable>
                      );
                    }
                    const occupee = enCoursPour === p.id;
                    const autorise = Boolean(p.autorisation?.autorise);
                    const etat = retour ? 'attenuee' : p.dernier?.vivant ? 'vivante' : autorise && !p.archive ? 'normale' : 'attenuee';
                    return (
                      <Fragment key={p.id}>
                        <LigneTable etat={etat}>
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
                            {...(!retour && p.rappel?.quand && p.rappel.texte ? { titre: `« ${p.rappel.texte} »` } : {})}
                            className="text-encre-3 max-sm:order-3 max-sm:basis-full max-sm:text-sm"
                          >
                            {retour ? (
                              <span className={retour.alerte ? 'text-alerte' : 'text-encre-2'}>{retour.texte}</span>
                            ) : (
                              <>
                                <EtatAppel p={p} />
                                {/* Sous 640 px, le rappel ou le dernier appel sur sa ligne, le détail dessous. */}
                                {p.detail ? (
                                  <span className="sm:hidden">
                                    {p.dernier || p.rappel ? <br /> : null}
                                    {p.detail}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </Cellule>
                          {/* Sous 640 px, seules les exceptions restent : « Autorisé » est le cas normal. */}
                          <Cellule align="droite" className={`max-sm:order-2 ${autorise ? 'max-sm:hidden' : ''}`}>
                            <PastilleAutorisation autorisation={p.autorisation} />
                          </Cellule>
                          <Cellule masqueeMobile>
                            <span className="relative z-10 -mx-1.5 flex items-center gap-x-4">
                              {retour?.defaire ? (
                                <Action
                                  ton="discret"
                                  disabled={occupee}
                                  enCours={occupee}
                                  libelleEnCours={retour.defaire === 'reactiver' ? 'Réactivation…' : 'Archivage…'}
                                  aria-label={`Annuler : ${retour.defaire === 'reactiver' ? 'réactiver' : 'archiver de nouveau'} ${p.nom}`}
                                  onClick={() => basculerArchive(p, retour.defaire === 'reactiver')}
                                >
                                  Annuler
                                </Action>
                              ) : retour ? null : (
                                <>
                                  <Action
                                    ton="discret"
                                    disabled={occupee}
                                    enCours={occupee && !confirmationEffacement.ouverte}
                                    libelleEnCours={p.archive ? 'Réactivation…' : 'Archivage…'}
                                    aria-label={p.archive ? `Réactiver ${p.nom}` : `Archiver ${p.nom}`}
                                    onClick={() => basculerArchive(p, p.archive)}
                                  >
                                    {p.archive ? 'Réactiver' : 'Archiver'}
                                  </Action>
                                  <Action
                                    ton="discret"
                                    disabled={occupee}
                                    aria-label={`Effacer ${p.nom}`}
                                    aria-expanded={aEffacer?.p.id === p.id && confirmationEffacement.ouverte}
                                    onClick={(ev) => ouvrirEffacement(p, ev.currentTarget)}
                                  >
                                    Effacer
                                  </Action>
                                </>
                              )}
                            </span>
                          </Cellule>
                        </LigneTable>
                        {aEffacer?.p.id === p.id && confirmationEffacement.ouverte ? (
                          <div role="row" className="border-b border-filet py-2 max-sm:hidden">
                            <div role="cell">
                              {aEffacer.detail?.obstacle ? (
                                <Message
                                  ton="alerte"
                                  action={
                                    <Action ton="discret" touche="Échap" onClick={fermerEffacement}>
                                      Fermer
                                    </Action>
                                  }
                                >
                                  {aEffacer.detail.obstacle}
                                </Message>
                              ) : (
                                <Confirmation
                                  ouverte
                                  ton="alerte"
                                  question={`Effacer ${p.nom} définitivement ?`}
                                  libelleConfirmer="Effacer la personne"
                                  enCours={occupee || inventaireEnCours}
                                  libelleEnCours={aEffacer.detail ? 'Effacement…' : 'Inventaire…'}
                                  erreur={erreurEffacement}
                                  onConfirmer={() => (aEffacer.detail ? effacerPersonne(p) : undefined)}
                                  onAnnuler={fermerEffacement}
                                >
                                  {aEffacer.detail ? (
                                    <DetailEffacement efface={aEffacer.detail.efface} reste={aEffacer.detail.reste} />
                                  ) : (
                                    'Inventaire de ce qui sera effacé…'
                                  )}
                                </Confirmation>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </TableDense>
            </NavigationListe>
          )}
        </div>
      )}
    </div>
  );
}

/** Le retour d'un geste, écrit dans sa ligne ; `defaire` : le geste inverse proposé par « Annuler ». */
interface Retour {
  texte: string;
  alerte?: boolean;
  defaire?: 'archiver' | 'reactiver';
  /** Personne effacée depuis la liste : sa dernière ligne connue, son rang, le compte rendu. */
  efface?: { p: LigneProspect; rang: number; rapport: RapportEffacement };
}

/** En cours, rappel à faire ou dernier appel : l'état d'un prospect dans la colonne « Dernier appel ». */
function EtatAppel({ p }: { p: LigneProspect }) {
  if (p.dernier?.vivant) return <span className="text-antenne">En cours</span>;
  if (p.rappel) {
    return p.rappel.quand ? (
      <span className={p.rappel.enRetard ? 'text-encre' : 'text-encre-2'}>
        {p.rappel.enRetard ? <span className="text-alerte">Rappel en retard</span> : 'Rappel'} : {p.rappel.quand}
      </span>
    ) : (
      <span className="text-encre-2">Rappel convenu : {p.rappel.texte ? `« ${p.rappel.texte} »` : 'moment non précisé'}</span>
    );
  }
  if (p.dernier) {
    return (
      <>
        <span className="font-mono text-xs">{p.dernier.date}</span> · {p.dernier.libelle}
      </>
    );
  }
  return null;
}
