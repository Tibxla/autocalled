import { ISSUES_SYSTEME, LIBELLES_ISSUES, type IssueSysteme, type RappelDate } from '@autocalled/domain';
import { NavigationListe } from './clavier';
import { cleJour, estNonCompose, etatAppel, jourCourt, LIBELLE_NON_COMPOSE, libelleJour, LIGNES_COURTES, quandRappeler, rappelEnRetard, type TonEtat } from './format-appel';
import { Cellule, CelluleEnTete, Duree, EnTeteTable, GlypheEtape, Heure, LienLigne, LigneTable, TableDense } from './ui';

/**
 * Liste dense des appels (écran Appels, historique d'un prospect). Sans directive : rendue côté serveur, les
 * lignes complètes de la table appels (transcription, numéro) ne partent jamais au navigateur. Les colonnes
 * suivent les champs présents : sans prospect (historique d'un prospect), ni Prospect ni Entreprise.
 */

/** Passage de transcription qui contient le terme cherché, découpé pour le surligner. */
export interface ExtraitAppel {
  qui: string;
  avant: string;
  terme: string;
  apres: string;
}

export interface LigneAppel {
  id: string;
  debutLe: Date;
  ligne: string;
  /** `entrant` : le prospect a rappelé le téléphone passerelle (absent : sortant). */
  sens?: 'sortant' | 'entrant';
  statut: string;
  issueSysteme: IssueSysteme | null;
  dureeSecondes: number | null;
  resume: string | null;
  /** Nom du prospect ; absent dans l'historique d'un prospect. */
  prospect?: string;
  issue?: string | null;
  erreur?: string | null;
  conversationId?: string | null;
  bilan?: { etapeAtteinte: number } | null;
  finLe?: Date | null;
  societe?: string | null;
  entreprise?: string | null;
  nombreEtapes?: number | null;
  rendezVous?: boolean;
  libellePerso?: string | null;
  extrait?: ExtraitAppel | null;
  /** Vue « Rappels à faire » : quand rappeler et ce que le prospect a dit. */
  rappel?: { le: Date | null; quand: RappelDate | null; texte: string | null };
  /** Vue « Rappels à faire » : la fiche du prospect, d'où le rappel se lance (comme sur l'accueil). */
  ficheProspect?: string;
  /** Remplace /appels/{id}. */
  lien?: string;
}

/* ------------------------------------------------------------------ filtre d'issue (liste et fiche) */

export const CLE_SANS_BILAN = 'sans-bilan';
export const CLE_NON_COMPOSE = 'non-compose';
export type CleFiltreIssue = IssueSysteme | typeof CLE_NON_COMPOSE | typeof CLE_SANS_BILAN;

/** Les neuf filtres d'issue (Tous = leur somme) ; la liste des appels les compte en base (lib/lecture, CLE_ISSUE). */
export const FILTRES_ISSUE: readonly { cle: CleFiltreIssue; libelle: string }[] = [
  ...ISSUES_SYSTEME.map((cle) => ({ cle, libelle: LIBELLES_ISSUES[cle] })),
  { cle: CLE_NON_COMPOSE, libelle: LIBELLE_NON_COMPOSE },
  { cle: CLE_SANS_BILAN, libelle: 'Sans bilan' },
];

export function estFiltreIssue(valeur: string | undefined): valeur is CleFiltreIssue {
  return valeur === CLE_SANS_BILAN || valeur === CLE_NON_COMPOSE || (ISSUES_SYSTEME as readonly string[]).includes(valeur ?? '');
}

/**
 * Le filtre d'issue d'un appel, par son issue système. Sans issue, un appel que la ligne n'a pas composé a son filtre,
 * du même nom que sa ligne (« Non composé ») ; le reste (en cours, analyse, analyse en échec) est « Sans bilan ».
 */
export function cleFiltreIssue(a: {
  statut: string;
  conversationId?: string | null;
  issueSysteme: IssueSysteme | null;
}): CleFiltreIssue {
  return a.issueSysteme ?? (estNonCompose(a) ? CLE_NON_COMPOSE : CLE_SANS_BILAN);
}

/* ------------------------------------------------------------------ rendu */

const TONS: Record<TonEtat, string> = {
  antenne: 'text-antenne',
  alerte: 'text-alerte',
  encre: 'text-encre',
  'encre-2': 'text-encre-2',
  'encre-3': 'text-encre-3',
};

const COLONNES_COMPLETES = '52px 230px 130px 200px minmax(0,1fr) 44px';
const COLONNES_PROSPECT = '52px 210px minmax(0,1fr) 84px 44px';
const COLONNES_RAPPELS = '13rem 230px 130px minmax(0,1fr) 84px';

function lienDe(a: LigneAppel, depuis: string | undefined, recherche: string | undefined): string {
  const base = a.lien ?? `/appels/${a.id}`;
  const parametres = new URLSearchParams();
  if (depuis) parametres.set('depuis', depuis);
  if (recherche) parametres.set('q', recherche);
  const suite = parametres.toString();
  return suite ? `${base}${base.includes('?') ? '&' : '?'}${suite}` : base;
}

function Glyphe({ a, vivant }: { a: LigneAppel; vivant: boolean }) {
  const rendezVous = Boolean(a.rendezVous) || a.issueSysteme === 'rendez-vous-pris';
  if (vivant) return <GlypheEtape etat="vivant" />;
  if (a.statut === 'traitement') return <GlypheEtape etat="analyse" />;
  if (a.statut === 'echec') return <GlypheEtape etat="echec" />;
  if (a.statut !== 'termine' || !a.bilan) return <GlypheEtape etat="sans-bilan" rendezVous={rendezVous} />;
  return <GlypheEtape etape={a.bilan.etapeAtteinte} nombre={a.nombreEtapes ?? null} rendezVous={rendezVous} />;
}

function etatDe(a: LigneAppel, vivant: boolean, maintenant: Date) {
  return etatAppel({ ...a, erreur: a.erreur ?? null, conversationId: a.conversationId ?? null }, { vivant, libellePerso: a.libellePerso ?? null, maintenant });
}

function Issue({ a, vivant, maintenant, lien }: { a: LigneAppel; vivant: boolean; maintenant: Date; lien?: string }) {
  const etat = etatDe(a, vivant, maintenant);
  const systeme = etat.cle === 'issue' && a.libellePerso ? a.issueSysteme : null;
  const libelle = vivant ? 'En cours · rejoindre' : etat.libelle;
  const contenu = (
    <>
      <span className={TONS[vivant ? 'antenne' : etat.ton]}>{libelle}</span>
      {systeme ? <span className="text-encre-3"> · {LIBELLES_ISSUES[systeme]}</span> : null}
    </>
  );
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Glyphe a={a} vivant={vivant} />
      {lien ? (
        <LienLigne href={lien} prefetch={false} className="min-w-0 truncate decoration-souligne underline-offset-4 hover:underline">
          {contenu}
        </LienLigne>
      ) : (
        <span className="min-w-0 truncate">{contenu}</span>
      )}
    </span>
  );
}

/**
 * Le résumé, le passage trouvé, ou, sans l'un ni l'autre, le détail de l'état (l'erreur d'un appel non composé ou
 * d'une analyse en échec) : rien d'utile ne se cache dans une info-bulle, qui ne s'affiche jamais au doigt.
 */
function Resume({ a, avecLigne, detail }: { a: LigneAppel; avecLigne: boolean; detail?: string | undefined }) {
  // Sans colonne Ligne (liste complète), un appel simulé ou entrant le dit devant son résumé, en graphite : pas de badge.
  const simule =
    !avecLigne && a.ligne === 'simulation' ? (
      <span className="text-encre-3">simulé · </span>
    ) : !avecLigne && a.sens === 'entrant' ? (
      <span className="text-encre-2">a rappelé · </span>
    ) : null;
  if (a.extrait) {
    const { qui, avant, terme, apres } = a.extrait;
    return (
      <>
        {simule}
        <span className="font-semibold text-encre-2">{qui}</span> <span className="text-encre-3">{avant}</span>
        <mark className="rounded-[2px] bg-filet-2 text-encre">{terme}</mark>
        <span className="text-encre-3">{apres}</span>
      </>
    );
  }
  return (
    <span className="text-encre-3">
      {simule}
      {a.resume ?? detail ?? ''}
    </span>
  );
}

function texteExtrait(a: LigneAppel, detail?: string): string | undefined {
  if (a.extrait) return `${a.extrait.qui} : ${a.extrait.avant}${a.extrait.terme}${a.extrait.apres}`;
  return a.resume ?? detail;
}

/** Saut de rangée sous 640 px : heure, nom et durée d'abord, puis l'issue et le résumé. */
function Retour() {
  return <span aria-hidden="true" className="hidden h-0 basis-full max-sm:order-4 max-sm:block" />;
}

function Ligne({
  a,
  complete,
  vivant,
  maintenant,
  depuis,
  recherche,
}: {
  a: LigneAppel;
  complete: boolean;
  vivant: boolean;
  maintenant: Date;
  depuis: string | undefined;
  recherche: string | undefined;
}) {
  const lien = lienDe(a, depuis, recherche);
  const detail = etatDe(a, vivant, maintenant).detail;
  if (complete) {
    return (
      <LigneTable etat={vivant ? 'vivante' : 'normale'}>
        <Cellule mono className="max-sm:order-1">
          <Heure date={a.debutLe} />
        </Cellule>
        <Cellule tronquee titre={[a.prospect, a.societe].filter(Boolean).join(' · ')} className="max-sm:order-2 max-sm:flex-1">
          <LienLigne href={lien} prefetch={false} className="font-medium decoration-souligne underline-offset-4 hover:underline">
            {a.prospect}
          </LienLigne>
          {a.societe ? <span className="text-encre-3"> · {a.societe}</span> : null}
        </Cellule>
        <Cellule tronquee attenuee masqueeMobile titre={a.entreprise ?? undefined}>
          {a.entreprise}
        </Cellule>
        <Cellule etat className="max-sm:order-5">
          <Issue a={a} vivant={vivant} maintenant={maintenant} />
        </Cellule>
        <Cellule tronquee titre={texteExtrait(a, detail)} className="max-sm:order-6 max-sm:flex-1">
          <Resume a={a} avecLigne={false} detail={detail} />
        </Cellule>
        <Cellule mono align="droite" className="max-sm:order-3">
          <Duree secondes={a.dureeSecondes} />
        </Cellule>
        <Retour />
      </LigneTable>
    );
  }
  return (
    <LigneTable etat={vivant ? 'vivante' : 'normale'}>
      <Cellule mono className="max-sm:order-1">
        <Heure date={a.debutLe} />
      </Cellule>
      <Cellule etat className="max-sm:order-2 max-sm:flex-1">
        <Issue a={a} vivant={vivant} maintenant={maintenant} lien={lien} />
      </Cellule>
      <Cellule tronquee titre={texteExtrait(a, detail)} className="max-sm:order-5 max-sm:flex-1">
        <Resume a={a} avecLigne detail={detail} />
      </Cellule>
      <Cellule attenuee masqueeMobile>
        {a.sens === 'entrant' ? 'entrant' : (LIGNES_COURTES[a.ligne] ?? a.ligne)}
      </Cellule>
      <Cellule mono align="droite" className="max-sm:order-3">
        <Duree secondes={a.dureeSecondes} />
      </Cellule>
      <Retour />
    </LigneTable>
  );
}

/**
 * Vue « Rappels à faire » : quand rappeler (en brique s'il est en retard), qui, ce qui a été convenu, le jour de l'appel
 * d'origine. La ligne mène à la fiche du prospect, d'où le rappel se lance, comme sur l'accueil. Sous 640 px : le nom
 * seul sur la première rangée, puis le « quand » en tête de la seconde, suivi de ce qui a été convenu.
 */
function LigneRappel({ a, maintenant, depuis }: { a: LigneAppel; maintenant: Date; depuis: string | undefined }) {
  const r = a.rappel;
  const retard = r?.le ? rappelEnRetard(r.le, r.quand, maintenant) : false;
  const lien = a.ficheProspect ?? lienDe(a, depuis, undefined);
  return (
    <LigneTable>
      <Cellule tronquee className="max-sm:order-2 max-sm:shrink-0">
        {r?.le ? (
          <span className={retard ? 'text-encre' : 'text-encre-2'}>
            {retard ? <span className="text-alerte">En retard · </span> : null}
            {quandRappeler(r.le, r.quand, maintenant)}
          </span>
        ) : (
          <span className="text-encre-3">sans date</span>
        )}
      </Cellule>
      <Cellule tronquee titre={[a.prospect, a.societe].filter(Boolean).join(' · ')} className="max-sm:order-1 max-sm:basis-full">
        <LienLigne href={lien} prefetch={false} className="font-medium decoration-souligne underline-offset-4 hover:underline">
          {a.prospect}
        </LienLigne>
        {a.societe ? <span className="text-encre-3"> · {a.societe}</span> : null}
      </Cellule>
      <Cellule tronquee attenuee masqueeMobile titre={a.entreprise ?? undefined}>
        {a.entreprise}
      </Cellule>
      <Cellule tronquee titre={r?.texte ?? undefined} className="text-encre-3 max-sm:order-3 max-sm:flex-1">
        {r?.texte ? `« ${r.texte} »` : ''}
      </Cellule>
      <Cellule mono align="droite" masqueeMobile className="text-encre-3">
        <span title={`Appel du ${jourCourt(a.debutLe)}`}>{jourCourt(a.debutLe).split(' ')[1]}</span>
      </Cellule>
    </LigneTable>
  );
}

function Intertitre({ libelle, nombre, ici, colonnes }: { libelle: string; nombre: number; ici: number; colonnes: number }) {
  return (
    <div role="row" className="border-b border-filet-2 pt-6 pb-1.5 text-sm">
      <span role="cell" aria-colspan={colonnes} className="font-medium text-encre-2">
        {libelle}
        <span className="font-normal text-encre-3">
          {' · '}
          <span className="font-mono">{nombre}</span> appel{nombre > 1 ? 's' : ''}
          {ici < nombre ? (
            <>
              {', '}
              <span className="font-mono">{ici}</span> sur cette page
            </>
          ) : null}
        </span>
      </span>
    </div>
  );
}

export function ListeAppels({
  appels,
  depuis,
  vivantId,
  navigationClavier = false,
  recherche,
  libelle = 'Appels',
  comptesJours,
  rappels = false,
}: {
  appels: LigneAppel[];
  /** URL de la liste d'origine, ajoutée aux liens (?depuis=) : retour, appel suivant et précédent sur la fiche. */
  depuis?: string;
  /** L'appel que la ligne téléphone porte en ce moment : épinglé en tête. */
  vivantId?: string | null;
  /** j, k, ↓, ↑, Début, Fin, avec la ligne ouverte retrouvée au retour. */
  navigationClavier?: boolean;
  /** Terme cherché, transmis à la fiche (?q=) pour surligner la transcription. */
  recherche?: string;
  libelle?: string;
  /** Appels de chaque jour (`AAAA-MM-JJ`, jour de Paris) comptés en base : un jour coupé par la pagination garde son vrai total. */
  comptesJours?: Readonly<Record<string, number>>;
  /** Vue « Rappels à faire » : une ligne par rappel, dans l'ordre reçu (du plus ancien au plus tardif), sans jours. */
  rappels?: boolean;
}) {
  const maintenant = new Date();
  if (rappels) {
    const table = (
      <TableDense libelle={libelle} colonnes={COLONNES_RAPPELS}>
        <EnTeteTable>
          <CelluleEnTete>Quand</CelluleEnTete>
          <CelluleEnTete>Prospect</CelluleEnTete>
          <CelluleEnTete masqueeMobile>Entreprise</CelluleEnTete>
          <CelluleEnTete>Convenu</CelluleEnTete>
          <CelluleEnTete align="droite" masqueeMobile>
            Appel
          </CelluleEnTete>
        </EnTeteTable>
        <div role="rowgroup">
          {appels.map((a) => (
            <LigneRappel key={a.id} a={a} maintenant={maintenant} depuis={depuis} />
          ))}
        </div>
      </TableDense>
    );
    return navigationClavier ? <NavigationListe memoriser="appels">{table}</NavigationListe> : table;
  }
  const complete = appels.some((a) => a.prospect !== undefined);
  const vivant = vivantId ? appels.find((a) => a.id === vivantId && a.statut === 'en-cours') : undefined;
  const autres = vivant ? appels.filter((a) => a !== vivant) : appels;

  const jours: { cle: string; libelle: string; appels: LigneAppel[] }[] = [];
  for (const a of autres) {
    const cle = cleJour(a.debutLe);
    const dernier = jours.at(-1);
    if (dernier?.cle === cle) dernier.appels.push(a);
    else jours.push({ cle, libelle: libelleJour(a.debutLe, maintenant), appels: [a] });
  }

  const proprietes = { complete, maintenant, depuis, recherche };
  const table = (
    <TableDense libelle={libelle} colonnes={complete ? COLONNES_COMPLETES : COLONNES_PROSPECT}>
      <EnTeteTable>
        <CelluleEnTete>Heure</CelluleEnTete>
        {complete ? (
          <>
            <CelluleEnTete>Prospect</CelluleEnTete>
            <CelluleEnTete masqueeMobile>Entreprise</CelluleEnTete>
          </>
        ) : null}
        <CelluleEnTete>Issue</CelluleEnTete>
        <CelluleEnTete>{recherche ? 'Passage trouvé' : 'Résumé'}</CelluleEnTete>
        {complete ? null : <CelluleEnTete masqueeMobile>Ligne</CelluleEnTete>}
        <CelluleEnTete align="droite">Durée</CelluleEnTete>
      </EnTeteTable>
      {vivant ? (
        <div role="rowgroup" aria-label="Appel en cours">
          <Ligne a={vivant} vivant {...proprietes} />
        </div>
      ) : null}
      {jours.map((j) => {
        // L'appel vivant, épinglé en tête, reste compté dans son jour.
        const ici = j.appels.length + (vivant && cleJour(vivant.debutLe) === j.cle ? 1 : 0);
        return (
          <div key={j.cle} role="rowgroup">
            <Intertitre libelle={j.libelle} nombre={Math.max(comptesJours?.[j.cle] ?? 0, ici)} ici={ici} colonnes={complete ? 6 : 5} />
            {j.appels.map((a) => (
              <Ligne key={a.id} a={a} vivant={false} {...proprietes} />
            ))}
          </div>
        );
      })}
    </TableDense>
  );
  return navigationClavier ? <NavigationListe memoriser="appels">{table}</NavigationListe> : table;
}
