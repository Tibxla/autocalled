import { DateTime } from 'luxon';
import { FUSEAU_RAPPEL, HEURES_MOMENT } from './bilan.ts';
import type { IssueSysteme } from './issues.ts';

/**
 * Cycle de vie d'une campagne : ses prospects sont appelés l'un après l'autre, un seul appel à la
 * fois (il n'y a qu'un téléphone passerelle). Fonctions pures : chaque transition renvoie une
 * nouvelle campagne ou lève `TransitionInvalide`.
 *
 * Un prospect qui ne répond pas (issue `non-abouti`) est rappelé le lendemain, au moment opposé de la
 * journée, jusqu'à `TENTATIVES_MAX` tentatives : toutes vivent dans son entrée, qui garde sa place.
 */

export type StatutCampagne = 'prete' | 'en-cours' | 'en-pause' | 'terminee';

export type RaisonSaut = 'numero-non-appelable';

/** Qui a fait un geste sur la file : l'interface, le serveur MCP (Claude Code) ou l'application elle-même. */
export type OrigineGeste = 'interface' | 'mcp' | 'systeme';

/**
 * `retrait` : l'opérateur a retiré ce prospect ; `fin-anticipee` : la campagne a été terminée avant lui ;
 * `rappel-entrant` : il a rappelé lui-même et parlé à l'assistante, sa nouvelle tentative n'a plus lieu d'être.
 */
export type MotifRetrait = 'retrait' | 'fin-anticipee' | 'rappel-entrant';

/** La trace d'un geste sur la file : quand (ISO) et par où. */
export interface TraceGeste {
  le: string;
  par: OrigineGeste;
}

/** Trois appels au plus par prospect et par campagne, le premier compris. */
export const TENTATIVES_MAX = 3;

/**
 * L'historique des tentatives d'une entrée, absent pour une première tentative. `tentative` : le numéro de la
 * tentative que porte l'entrée (absent : 1) ; `appelsPrecedents` : les appels des tentatives passées, dans
 * l'ordre, sans l'appel courant.
 */
export interface Tentatives {
  tentative?: number;
  appelsPrecedents?: string[];
}

/**
 * La campagne a été terminée pendant cet appel (trace du geste) : son issue, quelle qu'elle soit, ne crée plus de
 * nouvelle tentative. Absent sinon.
 */
export interface FinPendantLAppel {
  finDemandee?: TraceGeste;
}

export type EntreeCampagne =
  /**
   * `sauts` : combien de fois l'opérateur l'a renvoyé en fin de file (absent : jamais). `pasAvant` (ISO) : une
   * nouvelle tentative ne part pas avant cet instant.
   */
  | ({ prospectId: string; etat: 'a-appeler'; sauts?: number; pasAvant?: string } & Tentatives)
  | ({ prospectId: string; etat: 'en-appel'; appelId: string } & Tentatives & FinPendantLAppel)
  /** L'appel est fini, son issue pas encore connue : la file continue, la campagne ne peut pas se terminer. */
  | ({ prospectId: string; etat: 'en-analyse'; appelId: string } & Tentatives & FinPendantLAppel)
  /** `appelId` : le dernier appel. */
  | ({ prospectId: string; etat: 'appelee'; appelId: string } & Tentatives)
  | ({ prospectId: string; etat: 'sautee'; raisonSaut: RaisonSaut } & Pick<Tentatives, 'appelsPrecedents'>)
  /** Sorti de la file sans être appelé (de nouveau), par un geste ou par l'application ; la trace reste. */
  | ({ prospectId: string; etat: 'retiree'; motif: MotifRetrait } & TraceGeste & Pick<Tentatives, 'appelsPrecedents'>);

export interface Campagne {
  id: string;
  entrepriseId: string;
  versionScriptId: string;
  statut: StatutCampagne;
  entrees: EntreeCampagne[];
}

/** `jusqua` (ISO) : rien n'est dû avant cet instant, la prochaine tentative prévue ; absent s'il n'y a rien à attendre de daté. */
export type ActionCampagne = { type: 'attendre'; jusqua?: string } | { type: 'appeler'; prospectId: string };

export class TransitionInvalide extends Error {
  override name = 'TransitionInvalide';
}

export function creerCampagne(params: {
  id: string;
  entrepriseId: string;
  versionScriptId: string;
  prospectIds: readonly string[];
}): Campagne {
  if (params.prospectIds.length === 0) throw new TransitionInvalide('une campagne doit contenir au moins un prospect');
  const doublon = params.prospectIds.find((id, i) => params.prospectIds.indexOf(id) !== i);
  if (doublon) throw new TransitionInvalide(`le prospect « ${doublon} » apparaît deux fois`);

  return {
    id: params.id,
    entrepriseId: params.entrepriseId,
    versionScriptId: params.versionScriptId,
    statut: 'prete',
    entrees: params.prospectIds.map((prospectId) => ({ prospectId, etat: 'a-appeler' })),
  };
}

function appelEnCours(campagne: Campagne) {
  return campagne.entrees.find((e) => e.etat === 'en-appel');
}

const due = (entree: { pasAvant?: string }, maintenant: Date) =>
  entree.pasAvant === undefined || Date.parse(entree.pasAvant) <= maintenant.getTime();

/** Le premier prospect à appeler dont l'heure est venue, dans l'ordre de la file. */
function suivant(campagne: Campagne, maintenant: Date) {
  return campagne.entrees.find((e) => e.etat === 'a-appeler' && due(e, maintenant));
}

/** Seulement les champs présents : une première tentative n'en porte aucun. */
function historiqueDe(entree: Tentatives): Tentatives {
  return {
    ...(entree.tentative !== undefined && { tentative: entree.tentative }),
    ...(entree.appelsPrecedents !== undefined && { appelsPrecedents: entree.appelsPrecedents }),
  };
}

/**
 * Une campagne sans prospect restant (nouvelles tentatives à venir comprises), ni appel en cours ou en analyse,
 * est terminée, même en pause.
 */
function avecStatutAJour(campagne: Campagne): Campagne {
  const fini = !campagne.entrees.some((e) => e.etat === 'a-appeler' || e.etat === 'en-appel' || e.etat === 'en-analyse');
  return fini ? { ...campagne, statut: 'terminee' } : campagne;
}

function remplacerEntree(campagne: Campagne, prospectId: string, entree: EntreeCampagne): Campagne {
  return avecStatutAJour({
    ...campagne,
    entrees: campagne.entrees.map((e) => (e.prospectId === prospectId ? entree : e)),
  });
}

/** Démarre une campagne prête, ou reprend une campagne en pause. */
export function demarrer(campagne: Campagne): Campagne {
  if (campagne.statut !== 'prete' && campagne.statut !== 'en-pause') {
    throw new TransitionInvalide(`impossible de démarrer une campagne ${campagne.statut}`);
  }
  return { ...campagne, statut: 'en-cours' };
}

/** L'appel en cours va à son terme ; aucun nouvel appel ne part avant la reprise. */
export function mettreEnPause(campagne: Campagne): Campagne {
  if (campagne.statut !== 'en-cours') {
    throw new TransitionInvalide(`impossible de mettre en pause une campagne ${campagne.statut}`);
  }
  return { ...campagne, statut: 'en-pause' };
}

/**
 * Le prochain prospect dû, sinon attendre : la fin de l'appel en cours, ou la plus proche nouvelle tentative
 * (`jusqua`) quand plus rien n'est dû maintenant.
 */
export function prochaineAction(campagne: Campagne, maintenant: Date): ActionCampagne {
  if (campagne.statut !== 'en-cours' || appelEnCours(campagne)) return { type: 'attendre' };
  const prochain = suivant(campagne, maintenant);
  if (prochain) return { type: 'appeler', prospectId: prochain.prospectId };
  const echeances = campagne.entrees.flatMap((e) => (e.etat === 'a-appeler' && e.pasAvant !== undefined ? [e.pasAvant] : []));
  if (echeances.length === 0) return { type: 'attendre' };
  const jusqua = echeances.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
  return { type: 'attendre', jusqua };
}

export function debuterAppel(campagne: Campagne, prospectId: string, appelId: string, maintenant: Date): Campagne {
  if (campagne.statut !== 'en-cours') {
    throw new TransitionInvalide(`impossible d'appeler pendant une campagne ${campagne.statut}`);
  }
  if (appelEnCours(campagne)) throw new TransitionInvalide('un seul appel à la fois : un appel est déjà en cours');
  const prochain = suivant(campagne, maintenant);
  if (prochain?.prospectId !== prospectId) {
    throw new TransitionInvalide(`le prochain prospect à appeler n'est pas « ${prospectId} »`);
  }
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'en-appel', appelId, ...historiqueDe(prochain) });
}

/**
 * L'appel en cours est fini. Sans issue, l'entrée attend son classement (`en-analyse`, voir `classer`) ; avec
 * l'issue déjà connue (pas de décroché, simulation), elle est classée tout de suite.
 */
export function terminerAppel(campagne: Campagne, appelId: string): Campagne;
export function terminerAppel(campagne: Campagne, appelId: string, issueSysteme: IssueSysteme | null, finAppel: Date): Campagne;
export function terminerAppel(campagne: Campagne, appelId: string, issueSysteme?: IssueSysteme | null, finAppel?: Date): Campagne {
  const entree = appelEnCours(campagne);
  if (entree?.etat !== 'en-appel' || entree.appelId !== appelId) {
    throw new TransitionInvalide(`aucun appel en cours avec l'identifiant « ${appelId} »`);
  }
  const enAnalyse = remplacerEntree(campagne, entree.prospectId, {
    prospectId: entree.prospectId,
    etat: 'en-analyse',
    appelId,
    ...historiqueDe(entree),
    ...(entree.finDemandee && { finDemandee: entree.finDemandee }),
  });
  return issueSysteme === undefined || finAppel === undefined ? enAnalyse : classer(enAnalyse, appelId, issueSysteme, finAppel);
}

/**
 * Classe l'appel fini dont l'issue est maintenant connue (`null` : l'analyse a échoué). Un `non-abouti` avant la
 * dernière tentative repasse à appeler, à sa place, pas avant `prochaineTentative(finAppel)` ; tout le reste est
 * appelé. Sans entrée en analyse pour cet appel (déjà classé), la campagne est rendue telle quelle : une réanalyse
 * ne touche plus la file.
 */
export function classer(campagne: Campagne, appelId: string, issueSysteme: IssueSysteme | null, finAppel: Date): Campagne {
  const entree = campagne.entrees.find((e) => e.etat === 'en-analyse' && e.appelId === appelId);
  if (entree?.etat !== 'en-analyse') return campagne;
  const tentative = entree.tentative ?? 1;
  const retenter =
    issueSysteme === 'non-abouti' && tentative < TENTATIVES_MAX && campagne.statut !== 'terminee' && !finDemandee(campagne);
  return remplacerEntree(
    campagne,
    entree.prospectId,
    retenter
      ? {
          prospectId: entree.prospectId,
          etat: 'a-appeler',
          tentative: tentative + 1,
          appelsPrecedents: [...(entree.appelsPrecedents ?? []), appelId],
          pasAvant: prochaineTentative(finAppel),
        }
      : { prospectId: entree.prospectId, etat: 'appelee', appelId, ...historiqueDe(entree) },
  );
}

/** Avant 13 h à Paris, un appel sans réponse est retenté le lendemain à 14 h ; à partir de 13 h, le lendemain à 9 h. */
const HEURE_COUPURE = 13;

/**
 * L'instant (ISO) avant lequel une nouvelle tentative ne part pas : le lendemain calendaire, week-end compris (les
 * hébergements travaillent le week-end), au moment opposé de la journée, heure de Paris.
 */
export function prochaineTentative(finAppel: Date): string {
  const fin = DateTime.fromJSDate(finAppel, { zone: FUSEAU_RAPPEL });
  if (!fin.isValid) throw new TransitionInvalide('fin d’appel invalide : impossible de prévoir la nouvelle tentative');
  const [heure, minute] = HEURES_MOMENT[fin.hour < HEURE_COUPURE ? 'apres-midi' : 'matin'].split(':').map(Number);
  return fin.plus({ days: 1 }).set({ hour: heure, minute, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

/** Écarte un prospect sans l'appeler, quand son numéro n'est plus appelable au moment de composer (personne effacée, par exemple). */
export function sauter(campagne: Campagne, prospectId: string, raisonSaut: RaisonSaut): Campagne {
  const entree = campagne.entrees.find((e) => e.prospectId === prospectId);
  if (entree?.etat !== 'a-appeler') {
    throw new TransitionInvalide(`le prospect « ${prospectId} » n'est pas en attente d'appel`);
  }
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'sautee', raisonSaut, ...precedents(entree) });
}

/** Les appels déjà passés d'une entrée qui sort de la file : ses tentatives restent retrouvables. */
function precedents(entree: Tentatives): Pick<Tentatives, 'appelsPrecedents'> {
  return entree.appelsPrecedents ? { appelsPrecedents: entree.appelsPrecedents } : {};
}

function entreeAAppeler(campagne: Campagne, prospectId: string) {
  if (campagne.statut === 'terminee') throw new TransitionInvalide('la campagne est terminée');
  const entree = campagne.entrees.find((e) => e.prospectId === prospectId);
  if (entree?.etat !== 'a-appeler') {
    throw new TransitionInvalide(`le prospect « ${prospectId} » n'est pas en attente d'appel`);
  }
  return entree;
}

/**
 * La campagne a été terminée pendant un appel : plus aucun prospect à appeler, elle se termine quand cet
 * appel finit, sans nouvelle tentative. D'ici là, rien ne s'y ajoute.
 */
export function finDemandee(campagne: Campagne): boolean {
  return campagne.statut !== 'terminee' && traceDeFin(campagne) !== null;
}

/** Quand et par où la fin a été demandée : la trace des prospects qu'elle a retirés, ou celle posée sur l'appel en cours. */
export function traceDeFin(campagne: Pick<Campagne, 'entrees'>): TraceGeste | null {
  for (const e of campagne.entrees) {
    if (e.etat === 'retiree' && e.motif === 'fin-anticipee') return { le: e.le, par: e.par };
    if ((e.etat === 'en-appel' || e.etat === 'en-analyse') && e.finDemandee) return e.finDemandee;
  }
  return null;
}

/**
 * Le prospect est-il le dernier à appeler maintenant ? Une nouvelle tentative qui attend son heure ne compte pas :
 * le renvoyer derrière elle ne changerait rien, il resterait le prochain appelé.
 */
export function dernierDu(campagne: Campagne, prospectId: string, maintenant: Date): boolean {
  const rang = campagne.entrees.findIndex((e) => e.prospectId === prospectId);
  return !campagne.entrees.slice(rang + 1).some((e) => e.etat === 'a-appeler' && due(e, maintenant));
}

/**
 * « Sauter » de l'opérateur : le prospect repasse en fin de file, sans être appelé maintenant. Refusé s'il est
 * déjà le dernier à appeler maintenant (rien ne changerait).
 */
export function reporter(campagne: Campagne, prospectId: string, maintenant: Date): Campagne {
  const entree = entreeAAppeler(campagne, prospectId);
  if (dernierDu(campagne, prospectId, maintenant)) {
    throw new TransitionInvalide(`le prospect « ${prospectId} » est déjà le dernier à appeler`);
  }
  const autres = campagne.entrees.filter((e) => e.prospectId !== prospectId);
  // Après le dernier prospect à appeler : les entrées closes gardent leur rang.
  const dernier = autres.findLastIndex((e) => e.etat === 'a-appeler');
  const deplacee: EntreeCampagne = { ...entree, sauts: (entree.sauts ?? 0) + 1 };
  return { ...campagne, entrees: [...autres.slice(0, dernier + 1), deplacee, ...autres.slice(dernier + 1)] };
}

/**
 * Le pont a refusé de composer l'appel tout juste débuté (ligne prise entre-temps par un prospect qui rappelle) :
 * l'entrée redevient à appeler, avec son historique, comme si rien n'était parti. Si la fin a été demandée entre-temps,
 * elle est retirée comme les autres.
 */
export function annulerDebut(campagne: Campagne, appelId: string): Campagne {
  const entree = appelEnCours(campagne);
  if (entree?.etat !== 'en-appel' || entree.appelId !== appelId) {
    throw new TransitionInvalide(`aucun appel en cours avec l'identifiant « ${appelId} »`);
  }
  const { prospectId } = entree;
  return remplacerEntree(
    campagne,
    prospectId,
    entree.finDemandee
      ? { prospectId, etat: 'retiree', motif: 'fin-anticipee', ...entree.finDemandee, ...precedents(entree) }
      : { prospectId, etat: 'a-appeler', ...historiqueDe(entree) },
  );
}

/**
 * L'appel en analyse de ce prospect est tenu pour appelé : son bilan s'écrira sur l'appel, sans nouvelle tentative
 * (prospect archivé, par exemple). Toute autre entrée reste telle quelle.
 */
export function sansNouvelleTentative(campagne: Campagne, prospectId: string): Campagne {
  const entree = campagne.entrees.find((e) => e.prospectId === prospectId);
  if (entree?.etat !== 'en-analyse') return campagne;
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'appelee', appelId: entree.appelId, ...historiqueDe(entree) });
}

/** Retire un prospect de la file : il ne sera pas appelé dans cette campagne. */
export function retirer(campagne: Campagne, prospectId: string, trace: TraceGeste): Campagne {
  const entree = entreeAAppeler(campagne, prospectId);
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'retiree', motif: 'retrait', ...trace, ...precedents(entree) });
}

/**
 * Le prospect a rappelé et parlé à l'assistante : sa nouvelle tentative prévue n'a plus lieu d'être. Une entrée qui
 * n'en attend pas (jamais appelée, déjà close, campagne terminée) reste telle quelle.
 */
export function retirerTentativePrevue(campagne: Campagne, prospectId: string, le: Date): Campagne {
  if (campagne.statut === 'terminee') return campagne;
  const entree = campagne.entrees.find((e) => e.prospectId === prospectId);
  if (entree?.etat !== 'a-appeler' || (entree.tentative ?? 1) < 2) return campagne;
  return remplacerEntree(campagne, prospectId, {
    prospectId,
    etat: 'retiree',
    motif: 'rappel-entrant',
    le: le.toISOString(),
    par: 'systeme',
    ...precedents(entree),
  });
}

/** Ajoute des prospects en fin de file, dans l'ordre donné. Un prospect déjà dans la file, quel que soit son état, est refusé. */
export function ajouterProspects(campagne: Campagne, prospectIds: readonly string[]): Campagne {
  if (campagne.statut === 'terminee') throw new TransitionInvalide('impossible d’ajouter à une campagne terminée');
  if (finDemandee(campagne)) throw new TransitionInvalide('la campagne se termine après l’appel en cours');
  if (prospectIds.length === 0) throw new TransitionInvalide('aucun prospect à ajouter');
  const doublon = prospectIds.find((id, i) => prospectIds.indexOf(id) !== i || campagne.entrees.some((e) => e.prospectId === id));
  if (doublon) throw new TransitionInvalide(`le prospect « ${doublon} » est déjà dans la file`);
  return { ...campagne, entrees: [...campagne.entrees, ...prospectIds.map((prospectId) => ({ prospectId, etat: 'a-appeler' as const }))] };
}

/**
 * Termine la campagne avant la fin : chaque prospect encore à appeler, nouvelles tentatives à venir comprises, est
 * retiré, et un appel en analyse est tenu pour appelé (son issue s'écrira quand même sur l'appel). Sans appel en
 * cours, elle est terminée tout de suite ; sinon l'appel va à son terme, porte la trace du geste (son issue ne crée
 * pas de nouvelle tentative) et `terminerAppel` la termine.
 */
export function terminerAvantLaFin(campagne: Campagne, trace: TraceGeste): Campagne {
  if (campagne.statut === 'terminee') throw new TransitionInvalide('la campagne est déjà terminée');
  if (finDemandee(campagne)) throw new TransitionInvalide('la campagne se termine déjà avec l’appel en cours');
  if (!campagne.entrees.some((e) => e.etat === 'a-appeler' || e.etat === 'en-appel' || e.etat === 'en-analyse')) {
    throw new TransitionInvalide('plus aucun prospect à appeler');
  }
  return avecStatutAJour({
    ...campagne,
    entrees: campagne.entrees.map((e): EntreeCampagne => {
      if (e.etat === 'a-appeler') return { prospectId: e.prospectId, etat: 'retiree', motif: 'fin-anticipee', ...trace, ...precedents(e) };
      if (e.etat === 'en-analyse') return { prospectId: e.prospectId, etat: 'appelee', appelId: e.appelId, ...historiqueDe(e) };
      if (e.etat === 'en-appel') return { ...e, finDemandee: trace };
      return e;
    }),
  });
}
