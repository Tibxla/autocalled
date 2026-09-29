import { ISSUES_SYSTEME, LIBELLES_ISSUES, type IssueSysteme } from '@autocalled/domain';
import { NavigationListe } from './clavier';
import { cleJour, etatAppel, issueEffective, libelleJour, LIGNES_COURTES, type TonEtat } from './format-appel';
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
  /** Remplace /appels/{id}. */
  lien?: string;
}

/* ------------------------------------------------------------------ filtre d'issue (liste et fiche) */

export const CLE_SANS_BILAN = 'sans-bilan';
export type CleFiltreIssue = IssueSysteme | typeof CLE_SANS_BILAN;

/** Les huit filtres d'issue : ils partagent la fenêtre chargée (Tous = leur somme). */
export const FILTRES_ISSUE: readonly { cle: CleFiltreIssue; libelle: string }[] = [
  ...ISSUES_SYSTEME.map((cle) => ({ cle, libelle: LIBELLES_ISSUES[cle] })),
  { cle: CLE_SANS_BILAN, libelle: 'Sans bilan' },
];

export function estFiltreIssue(valeur: string | undefined): valeur is CleFiltreIssue {
  return valeur === CLE_SANS_BILAN || (ISSUES_SYSTEME as readonly string[]).includes(valeur ?? '');
}

/**
 * Le filtre d'issue d'un appel, par son issue effective : les non aboutis téléphone dont seule `issue` est
 * posée comptent enfin comme non aboutis ; tout le reste sans issue (en cours, analyse, échec) est « Sans bilan ».
 */
export function cleFiltreIssue(a: { issueSysteme: IssueSysteme | null; issue?: string | null }): CleFiltreIssue {
  return issueEffective(a) ?? CLE_SANS_BILAN;
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

function lienDe(a: LigneAppel, depuis: string | undefined, recherche: string | undefined): string {
  const base = a.lien ?? `/appels/${a.id}`;
  const parametres = new URLSearchParams();
  if (depuis) parametres.set('depuis', depuis);
  if (recherche) parametres.set('q', recherche);
  const suite = parametres.toString();
  return suite ? `${base}${base.includes('?') ? '&' : '?'}${suite}` : base;
}

function Glyphe({ a, vivant }: { a: LigneAppel; vivant: boolean }) {
  const rendezVous = Boolean(a.rendezVous) || issueEffective(a) === 'rendez-vous-pris';
  if (vivant) return <GlypheEtape etat="vivant" />;
  if (a.statut === 'traitement') return <GlypheEtape etat="analyse" />;
  if (a.statut === 'echec') return <GlypheEtape etat="echec" />;
  if (a.statut !== 'termine' || !a.bilan) return <GlypheEtape etat="sans-bilan" rendezVous={rendezVous} />;
  return <GlypheEtape etape={a.bilan.etapeAtteinte} nombre={a.nombreEtapes ?? null} rendezVous={rendezVous} />;
}

function Issue({ a, vivant, maintenant, lien }: { a: LigneAppel; vivant: boolean; maintenant: Date; lien?: string }) {
  const etat = etatAppel(
    { ...a, issue: a.issue ?? null, erreur: a.erreur ?? null, conversationId: a.conversationId ?? null },
    { vivant, libellePerso: a.libellePerso ?? null, maintenant },
  );
  const systeme = etat.cle === 'issue' && a.libellePerso ? issueEffective(a) : null;
  const libelle = vivant ? 'En cours · rejoindre' : etat.libelle;
  const contenu = (
    <>
      <span className={TONS[vivant ? 'antenne' : etat.ton]}>{libelle}</span>
      {systeme ? <span className="text-encre-3"> · {LIBELLES_ISSUES[systeme]}</span> : null}
    </>
  );
  return (
    <span className="flex min-w-0 items-center gap-2.5" title={etat.detail}>
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

function Resume({ a, avecLigne }: { a: LigneAppel; avecLigne: boolean }) {
  // Sans colonne Ligne (liste complète), un appel simulé le dit devant son résumé.
  const simule = !avecLigne && a.ligne === 'simulation' ? <span className="text-encre-3">simulé · </span> : null;
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
      {a.resume ?? ''}
    </span>
  );
}

function texteExtrait(a: LigneAppel): string | undefined {
  if (a.extrait) return `${a.extrait.qui} : ${a.extrait.avant}${a.extrait.terme}${a.extrait.apres}`;
  return a.resume ?? undefined;
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
        <Cellule tronquee titre={texteExtrait(a)} className="max-sm:order-6 max-sm:flex-1">
          <Resume a={a} avecLigne={false} />
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
      <Cellule tronquee titre={texteExtrait(a)} className="max-sm:order-5 max-sm:flex-1">
        <Resume a={a} avecLigne />
      </Cellule>
      <Cellule attenuee masqueeMobile>
        {LIGNES_COURTES[a.ligne] ?? a.ligne}
      </Cellule>
      <Cellule mono align="droite" className="max-sm:order-3">
        <Duree secondes={a.dureeSecondes} />
      </Cellule>
      <Retour />
    </LigneTable>
  );
}

function Intertitre({ libelle, nombre, colonnes }: { libelle: string; nombre: number; colonnes: number }) {
  return (
    <div role="row" className="border-b border-filet-2 pt-6 pb-1.5 text-sm">
      <span role="cell" aria-colspan={colonnes} className="font-medium text-encre-2">
        {libelle}
        <span className="font-normal text-encre-3">
          {' · '}
          <span className="font-mono">{nombre}</span> appel{nombre > 1 ? 's' : ''}
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
}) {
  const maintenant = new Date();
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
      {jours.map((j) => (
        <div key={j.cle} role="rowgroup">
          <Intertitre libelle={j.libelle} nombre={j.appels.length} colonnes={complete ? 6 : 5} />
          {j.appels.map((a) => (
            <Ligne key={a.id} a={a} vivant={false} {...proprietes} />
          ))}
        </div>
      ))}
    </TableDense>
  );
  return navigationClavier ? <NavigationListe memoriser="appels">{table}</NavigationListe> : table;
}
