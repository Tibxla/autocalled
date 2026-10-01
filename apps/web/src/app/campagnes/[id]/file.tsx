'use client';

import { ISSUES_SYSTEME, LIBELLES_ISSUES, type IssueSysteme, type MotifRetrait, type OrigineGeste } from '@autocalled/domain';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { NavigationListe, useRaccourcis } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { dateCourte, etatAppel, type TonEtat } from '@/components/format-appel';
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
import { retirerDeLaFile, sauterDansLaFile } from '../actions';

/**
 * La file d'une campagne : chaque prospect dans l'ordre d'appel, avec son appel s'il est parti. Filtres et
 * recherche restent dans la page (la liste est déjà chargée en entier) ; l'URL garde le filtre par
 * window.history.replaceState, sans relancer le rendu serveur que la régie rafraîchit déjà.
 *
 * Tant que la campagne n'est pas terminée, chaque prospect encore à appeler se saute (il repasse en fin de
 * file) ou se retire (il ne sera pas appelé dans cette campagne, et n'y revient pas). Sauter n'appelle personne
 * et se défait en le sautant encore : pas de confirmation, S sur la ligne sélectionnée (j, k). Retirer est
 * définitif pour la campagne : confirmé en ligne sous la ligne, sans touche. Sous 640 px, ces gestes ne restent
 * que sur la ligne « Suivant », et sur toutes les lignes à appeler quand ce filtre est actif.
 *
 * Le retour d'un geste s'écrit dans sa ligne, jamais au-dessus du tableau, hors de l'écran : un prospect sauté
 * reste à sa place, atténué, « Repasse en fin de file », sans geste, jusqu'à ce que l'opérateur relise la liste
 * (filtre, recherche) ; seule la ligne concernée attend pendant l'envoi. Une région d'état masquée l'annonce
 * aux lecteurs d'écran.
 */

export interface EntreeFile {
  rang: number;
  prospectId: string;
  nom: string;
  societe: string | null;
  etat: 'a-appeler' | 'en-appel' | 'appelee' | 'sautee' | 'retiree';
  suivant: boolean;
  /** Combien de fois l'opérateur l'a sauté (repassé en fin de file). */
  sauts: number;
  /** Retiré de la file : pourquoi, quand (ISO), par où. */
  retrait: { motif: MotifRetrait; le: string; par: OrigineGeste } | null;
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

type Categorie = 'a-appeler' | 'en-appel' | IssueSysteme | 'autres' | 'sautes' | 'retires';

/** Les issues toujours proposées ; les autres issues système n'apparaissent que si la file en compte. */
const ISSUES_TOUJOURS = new Set<IssueSysteme>(['rendez-vous-pris', 'rappel-convenu', 'refus', 'non-abouti']);

/** `vivante` : filtre sans objet une fois la campagne terminée (toujours à zéro). `toujours` : affiché même vide. */
const FILTRES: { cle: Categorie; libelle: string; vivante?: boolean; toujours?: boolean }[] = [
  { cle: 'a-appeler', libelle: 'À appeler', vivante: true, toujours: true },
  { cle: 'en-appel', libelle: 'En appel', vivante: true, toujours: true },
  ...ISSUES_SYSTEME.map((i) => ({ cle: i, libelle: LIBELLES_ISSUES[i], toujours: ISSUES_TOUJOURS.has(i) })),
  { cle: 'autres', libelle: 'Autres' },
  { cle: 'sautes', libelle: 'Non appelables', toujours: true },
  { cle: 'retires', libelle: 'Retirés', toujours: true },
];

const CLES = new Set<string>(FILTRES.map((f) => f.cle));

function categorie(e: EntreeFile): Categorie {
  if (e.etat === 'a-appeler') return 'a-appeler';
  if (e.etat === 'en-appel') return 'en-appel';
  if (e.etat === 'sautee') return 'sautes';
  if (e.etat === 'retiree') return 'retires';
  return e.appel?.issueSysteme ?? 'autres';
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

/**
 * Le retour d'un geste, écrit dans la ligne. `place` : un prospect sauté garde sa place d'avant le geste tant
 * que la liste n'est pas relue (la page, elle, l'a déjà renvoyé en fin de file) ; son rang dit déjà le nouveau.
 */
interface Retour {
  texte: string;
  ton: 'neutre' | 'alerte';
  place?: number;
}

/** Les prospects sautés remis à la place qu'ils avaient au moment du geste, tant qu'ils sont encore à appeler. */
function ordonner(entrees: EntreeFile[], retours: ReadonlyMap<string, Retour>): EntreeFile[] {
  const figees = entrees
    .filter((e) => e.etat === 'a-appeler' && retours.get(e.prospectId)?.place !== undefined)
    .sort((a, b) => (retours.get(a.prospectId)?.place ?? 0) - (retours.get(b.prospectId)?.place ?? 0));
  if (figees.length === 0) return entrees;
  const ids = new Set(figees.map((e) => e.prospectId));
  const liste = entrees.filter((e) => !ids.has(e.prospectId));
  for (const e of figees) liste.splice(Math.min(retours.get(e.prospectId)?.place ?? liste.length, liste.length), 0, e);
  return liste;
}

function Issue({ e }: { e: EntreeFile }) {
  if (e.etat === 'a-appeler') {
    const repasse = e.sauts > 0 ? ` · repassé${e.sauts > 1 ? ` ${e.sauts} fois` : ''} en fin de file` : '';
    return e.suivant ? <span className="text-encre-2">Suivant{repasse}</span> : <span className="text-encre-3">À appeler{repasse}</span>;
  }
  if (e.etat === 'sautee') return <span className="text-encre-3">Non appelé : numéro invalide ou effacé</span>;
  if (e.etat === 'retiree') {
    const quand = e.retrait ? dateCourte(e.retrait.le).replace(' ', ' à ') : null;
    const par = e.retrait?.par === 'mcp' ? ' par Claude Code' : '';
    const texte =
      e.retrait?.motif === 'fin-anticipee'
        ? `Non appelé : campagne terminée${quand ? ` le ${quand}` : ''}${par}`
        : `Retiré${quand ? ` le ${quand}` : ''}${par}`;
    return <span className="text-encre-3">{texte}</span>;
  }
  if (e.etat === 'en-appel' && (!e.appel || e.appel.statut === 'en-cours')) return <span>En appel</span>;
  if (!e.appel) return <span className="text-encre-3">Sans appel</span>;
  const etat = etatAppel(e.appel, { libellePerso: e.appel.libellePerso });
  // Le détail d'un échec : au survol au pointeur fin, en toutes lettres sous 640 px (rien ne s'y lit au survol).
  return (
    <span className={TONS[etat.ton]} title={etat.detail}>
      {etat.libelle}
      {etat.detail ? <span className="text-encre-3 sm:hidden"> · {etat.detail}</span> : null}
    </span>
  );
}

function Glyphe({ e, nombreEtapes }: { e: EntreeFile; nombreEtapes: number | null }) {
  if (e.etat === 'en-appel') return <GlypheEtape etat="vivant" />;
  const a = e.appel;
  if (!a) return null;
  const etat = a.statut === 'echec' ? 'echec' : a.statut === 'traitement' ? 'analyse' : a.etape === null ? 'sans-bilan' : 'bilan';
  return <GlypheEtape etat={etat} etape={a.etape} nombre={nombreEtapes} rendezVous={a.issueSysteme === 'rendez-vous-pris'} />;
}

export function File({
  entrees,
  nombreEtapes,
  slug,
  campagneId,
  filtreInitial,
  gestes = false,
  terminee = false,
}: {
  entrees: EntreeFile[];
  nombreEtapes: number | null;
  slug: string;
  /** Ajouté aux liens des appels (?depuis=) : la fiche d'appel revient à la campagne. */
  campagneId: string;
  filtreInitial?: string | undefined;
  /** Sauter et Retirer sont proposés (campagne ni terminée ni en train de se terminer). */
  gestes?: boolean;
  /** Campagne terminée : « À appeler » et « En appel », toujours vides, ne sont plus proposés. */
  terminee?: boolean;
}) {
  const depuis = `?depuis=${encodeURIComponent(`/campagnes/${campagneId}`)}`;
  const [enCours, demarrer] = useTransition();
  const [retours, setRetours] = useState<ReadonlyMap<string, Retour>>(() => new Map());
  // Pour les lecteurs d'écran seulement : le retour visible est dans la ligne.
  const [annonce, setAnnonce] = useState('');
  // Les lignes dont un geste est en cours d'envoi : elles seules attendent.
  const [enAttente, setEnAttente] = useState<ReadonlySet<string>>(() => new Set());
  const derniereAAppeler = entrees.findLast((e) => e.etat === 'a-appeler')?.prospectId ?? null;

  const ecrire = (id: string, retour: Retour | null) =>
    setRetours((r) => {
      const suivant = new Map(r);
      if (retour) suivant.set(id, retour);
      else suivant.delete(id);
      return suivant;
    });
  const attendre = (id: string, oui: boolean) =>
    setEnAttente((a) => {
      const suivant = new Set(a);
      if (oui) suivant.add(id);
      else suivant.delete(id);
      return suivant;
    });
  /** Relire la liste (filtre, recherche) : les prospects sautés rejoignent leur nouvelle place, les retours s'effacent. */
  const relire = () => setRetours(new Map());

  const confirmationRetrait = useConfirmation();
  const [aRetirer, setARetirer] = useState<EntreeFile | null>(null);
  const fermerRetrait = () => {
    setARetirer(null);
    confirmationRetrait.fermer();
  };

  const geste = (e: EntreeFile, quoi: 'sauter' | 'retirer') => {
    const id = e.prospectId;
    if (quoi === 'sauter' && id === derniereAAppeler) {
      ecrire(id, { texte: 'Déjà le dernier à appeler', ton: 'neutre' });
      setAnnonce(`${e.nom} est déjà le dernier à appeler.`);
      return;
    }
    // Place d'avant le geste, dans la liste telle qu'elle s'affiche (un prospect déjà sauté compris).
    const place = ordonner(entrees, retours).findIndex((x) => x.prospectId === id);
    ecrire(id, null);
    attendre(id, true);
    demarrer(async () => {
      try {
        if (quoi === 'sauter') {
          const r = await sauterDansLaFile(campagneId, id);
          ecrire(id, r.ok ? { texte: 'Repasse en fin de file', ton: 'neutre', place } : { texte: r.raison, ton: 'alerte' });
          setAnnonce(r.ok ? `${e.nom} repasse en fin de file.` : r.raison);
        } else {
          const r = await retirerDeLaFile(campagneId, id);
          // Réussi, la ligne le dit d'elle-même (« Retiré le … ») ; la fin de la campagne se voit dans la régie.
          if (!r.ok) ecrire(id, { texte: r.raison, ton: 'alerte' });
          setAnnonce(
            r.ok
              ? `${e.nom} est retiré de la file : il ne sera pas appelé dans cette campagne.${r.terminee ? ' Plus personne à appeler : la campagne est terminée.' : ''}`
              : r.raison,
          );
        }
      } catch {
        ecrire(id, { texte: 'Le geste n’a pas abouti : relis la page et réessaie.', ton: 'alerte' });
        setAnnonce('Le geste n’a pas abouti : relis la page et réessaie.');
      }
      attendre(id, false);
      if (quoi === 'retirer') fermerRetrait();
    });
  };

  /** La ligne sélectionnée (j, k) ou qui porte le focus, si elle est encore à appeler. */
  const entreeSelectionnee = () => {
    const ligne = document.activeElement?.closest<HTMLElement>('[data-ligne]') ?? document.querySelector<HTMLElement>('#file-table [data-selectionnee]');
    const id = ligne?.id.startsWith('file-') ? ligne.id.slice(5) : null;
    return entrees.find((e) => e.prospectId === id && e.etat === 'a-appeler');
  };
  useRaccourcis([
    {
      touche: 's',
      libelle: 'Sauter le prospect sélectionné',
      groupe: 'Liste',
      actif: gestes && !enCours,
      action: () => {
        const e = entreeSelectionnee();
        if (!e) return false;
        geste(e, 'sauter');
      },
    },
  ]);
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
  const visibles = ordonner(entrees, retours).filter(
    (e) =>
      (filtre === null || categorie(e) === filtre) &&
      (recherche === '' || sansAccents(`${e.nom} ${e.societe ?? ''}`).includes(recherche)),
  );

  const choisir = (suivant: Categorie | null) => {
    relire();
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

  const chercher = (valeur: string) => {
    relire();
    setTexte(valeur);
  };

  return (
    <div className="grid grid-cols-1 gap-3 pt-3">
      {/* Sous 640 px, la recherche en tête, pleine largeur, puis la rangée de filtres qui défile. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 max-sm:grid max-sm:grid-cols-1">
        <Filtres libelle="Filtrer la file">
          <Filtre actif={filtre === null} compte={entrees.length} onClick={() => choisir(null)}>
            Tous
          </Filtre>
          {FILTRES.filter((f) => filtre === f.cle || ((!terminee || !f.vivante) && (f.toujours || (comptes.get(f.cle) ?? 0) > 0))).map((f) => (
            <Filtre key={f.cle} actif={filtre === f.cle} compte={comptes.get(f.cle) ?? 0} onClick={() => choisir(f.cle)}>
              {f.libelle}
            </Filtre>
          ))}
        </Filtres>
        <Recherche
          key={cleRecherche}
          placeholder="Chercher un prospect"
          libelle="Chercher dans la file"
          instantane={chercher}
          className="w-full max-sm:order-first sm:w-[300px]"
        />
      </div>

      <p role="status" className="sr-only">
        {annonce}
      </p>

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
          {texte ? (
            <>
              <span className="pointer-coarse:hidden">Vide la recherche (Échap dans le champ) ou change de filtre.</span>
              <span className="hidden pointer-coarse:inline">Efface la recherche ou change de filtre.</span>
            </>
          ) : null}
        </EtatVide>
      ) : (
        <NavigationListe>
          <div ref={table} id="file-table">
            <TableDense
              libelle="File de la campagne"
              colonnes={`2.5rem minmax(0,1fr) 3.5rem 3.5rem 4.5rem minmax(9rem,16rem)${gestes ? ' 10rem' : ''}`}
            >
              <EnTeteTable>
                <CelluleEnTete>Rang</CelluleEnTete>
                <CelluleEnTete>Prospect</CelluleEnTete>
                <CelluleEnTete masqueeMobile>Heure</CelluleEnTete>
                <CelluleEnTete align="droite" masqueeMobile>
                  Durée
                </CelluleEnTete>
                <CelluleEnTete masqueeMobile>Étape</CelluleEnTete>
                <CelluleEnTete>Issue</CelluleEnTete>
                {gestes ? (
                  <CelluleEnTete>
                    <span className="sr-only">Gestes</span>
                  </CelluleEnTete>
                ) : null}
              </EnTeteTable>
              <div role="rowgroup">
                {visibles.map((e) => {
                  const retour = retours.get(e.prospectId);
                  // Sauté : à sa place d'avant, atténué, sans geste, jusqu'à la relecture de la liste.
                  const saute = e.etat === 'a-appeler' && retour?.place !== undefined;
                  // Un retour ne vaut que pour l'état qui l'a vu naître : l'appel parti, la ligne reprend sa vie.
                  const visible = retour && e.etat === 'a-appeler' ? retour : null;
                  const avecGestes = e.etat === 'a-appeler' && !saute;
                  // Sous 640 px, seulement sur la ligne « Suivant », ou partout quand « À appeler » est le filtre.
                  const gestesMobile = e.suivant || filtre === 'a-appeler';
                  const attend = enAttente.has(e.prospectId);
                  return [
                    <LigneTable
                      key={e.prospectId}
                      id={`file-${e.prospectId}`}
                      etat={e.etat === 'en-appel' ? 'vivante' : e.etat === 'sautee' || e.etat === 'retiree' || saute ? 'attenuee' : 'normale'}
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
                        {visible ? <span className={visible.ton === 'alerte' ? 'text-alerte' : 'text-encre-2'}>{visible.texte}</span> : <Issue e={e} />}
                      </Cellule>
                      {gestes ? (
                        <Cellule className={`max-sm:order-6 max-sm:basis-full max-sm:pl-10 ${avecGestes && gestesMobile ? '' : 'max-sm:hidden'}`}>
                          {avecGestes ? (
                            <span className="relative z-10 -mx-1.5 flex items-center gap-x-4">
                              <Action
                                ton="discret"
                                touche="S"
                                className="[&_.touche]:hidden in-data-selectionnee:[&_.touche]:inline-flex"
                                disabled={attend}
                                aria-label={`Sauter ${e.nom} : repasse en fin de file`}
                                onClick={() => geste(e, 'sauter')}
                              >
                                Sauter
                              </Action>
                              {/* Au doigt, un filet entre le geste immédiat et celui qui demande confirmation. */}
                              <span aria-hidden="true" className="hidden h-5 w-px bg-filet pointer-coarse:block" />
                              <Action
                                ton="discret"
                                disabled={attend}
                                aria-label={`Retirer ${e.nom} de la file`}
                                aria-expanded={aRetirer?.prospectId === e.prospectId}
                                onClick={(ev) => {
                                  setARetirer(e);
                                  confirmationRetrait.ouvrir(ev.currentTarget);
                                }}
                              >
                                Retirer
                              </Action>
                            </span>
                          ) : null}
                        </Cellule>
                      ) : null}
                    </LigneTable>,
                    aRetirer?.prospectId === e.prospectId && confirmationRetrait.ouverte ? (
                      <div key={`retrait-${e.prospectId}`} role="row" className="border-b border-filet py-2">
                        <div role="cell">
                          <Confirmation
                            ouverte
                            ton="alerte"
                            question={`Retirer ${e.nom} de la file ?`}
                            libelleConfirmer="Retirer"
                            enCours={attend}
                            libelleEnCours="Retrait…"
                            onConfirmer={() => geste(e, 'retirer')}
                            onAnnuler={fermerRetrait}
                          >
                            Il ne sera pas appelé dans cette campagne, et ne pourra plus y revenir.
                          </Confirmation>
                        </div>
                      </div>
                    ) : null,
                  ];
                })}
              </div>
            </TableDense>
          </div>
        </NavigationListe>
      )}
    </div>
  );
}
