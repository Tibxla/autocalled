/**
 * Cycle de vie d'une campagne : ses prospects sont appelés l'un après l'autre, un seul appel à la
 * fois (il n'y a qu'un téléphone passerelle). Fonctions pures : chaque transition renvoie une
 * nouvelle campagne ou lève `TransitionInvalide`.
 */

export type StatutCampagne = 'prete' | 'en-cours' | 'en-pause' | 'terminee';

export type RaisonSaut = 'numero-non-autorise';

/** Qui a fait un geste sur la file : l'interface ou le serveur MCP (Claude Code). */
export type OrigineGeste = 'interface' | 'mcp';

/** `retrait` : l'opérateur a retiré ce prospect ; `fin-anticipee` : la campagne a été terminée avant lui. */
export type MotifRetrait = 'retrait' | 'fin-anticipee';

/** La trace d'un geste sur la file : quand (ISO) et par où. */
export interface TraceGeste {
  le: string;
  par: OrigineGeste;
}

export type EntreeCampagne =
  /** `sauts` : combien de fois l'opérateur l'a renvoyé en fin de file (absent : jamais). */
  | { prospectId: string; etat: 'a-appeler'; sauts?: number }
  | { prospectId: string; etat: 'en-appel'; appelId: string }
  | { prospectId: string; etat: 'appelee'; appelId: string }
  | { prospectId: string; etat: 'sautee'; raisonSaut: RaisonSaut }
  /** Sorti de la file sans être appelé, par un geste de l'opérateur ; la trace reste. */
  | ({ prospectId: string; etat: 'retiree'; motif: MotifRetrait } & TraceGeste);

export interface Campagne {
  id: string;
  entrepriseId: string;
  versionScriptId: string;
  statut: StatutCampagne;
  entrees: EntreeCampagne[];
}

export type ActionCampagne = { type: 'attendre' } | { type: 'appeler'; prospectId: string };

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

function suivant(campagne: Campagne) {
  return campagne.entrees.find((e) => e.etat === 'a-appeler');
}

/** Une campagne sans prospect restant ni appel en cours est terminée, même en pause. */
function avecStatutAJour(campagne: Campagne): Campagne {
  const fini = !suivant(campagne) && !appelEnCours(campagne);
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

export function prochaineAction(campagne: Campagne): ActionCampagne {
  if (campagne.statut !== 'en-cours' || appelEnCours(campagne)) return { type: 'attendre' };
  const prochain = suivant(campagne);
  return prochain ? { type: 'appeler', prospectId: prochain.prospectId } : { type: 'attendre' };
}

export function debuterAppel(campagne: Campagne, prospectId: string, appelId: string): Campagne {
  if (campagne.statut !== 'en-cours') {
    throw new TransitionInvalide(`impossible d'appeler pendant une campagne ${campagne.statut}`);
  }
  if (appelEnCours(campagne)) throw new TransitionInvalide('un seul appel à la fois : un appel est déjà en cours');
  const prochain = suivant(campagne);
  if (prochain?.prospectId !== prospectId) {
    throw new TransitionInvalide(`le prochain prospect à appeler n'est pas « ${prospectId} »`);
  }
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'en-appel', appelId });
}

export function terminerAppel(campagne: Campagne, appelId: string): Campagne {
  const entree = appelEnCours(campagne);
  if (entree?.etat !== 'en-appel' || entree.appelId !== appelId) {
    throw new TransitionInvalide(`aucun appel en cours avec l'identifiant « ${appelId} »`);
  }
  return remplacerEntree(campagne, entree.prospectId, { prospectId: entree.prospectId, etat: 'appelee', appelId });
}

/** Écarte un prospect sans l'appeler, par exemple quand son numéro n'est plus autorisé au moment de composer. */
export function sauter(campagne: Campagne, prospectId: string, raisonSaut: RaisonSaut): Campagne {
  const entree = campagne.entrees.find((e) => e.prospectId === prospectId);
  if (entree?.etat !== 'a-appeler') {
    throw new TransitionInvalide(`le prospect « ${prospectId} » n'est pas en attente d'appel`);
  }
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'sautee', raisonSaut });
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
 * appel finit. D'ici là, rien ne s'y ajoute.
 */
export function finDemandee(campagne: Campagne): boolean {
  return campagne.statut !== 'terminee' && campagne.entrees.some((e) => e.etat === 'retiree' && e.motif === 'fin-anticipee');
}

/**
 * « Sauter » de l'opérateur : le prospect repasse en fin de file, sans être appelé maintenant. Refusé s'il est
 * déjà le dernier à appeler (rien ne changerait).
 */
export function reporter(campagne: Campagne, prospectId: string): Campagne {
  const entree = entreeAAppeler(campagne, prospectId);
  const rang = campagne.entrees.indexOf(entree);
  if (!campagne.entrees.slice(rang + 1).some((e) => e.etat === 'a-appeler')) {
    throw new TransitionInvalide(`le prospect « ${prospectId} » est déjà le dernier à appeler`);
  }
  const autres = campagne.entrees.filter((e) => e.prospectId !== prospectId);
  // Après le dernier prospect à appeler : les entrées closes gardent leur rang.
  const dernier = autres.findLastIndex((e) => e.etat === 'a-appeler');
  const deplacee: EntreeCampagne = { prospectId, etat: 'a-appeler', sauts: (entree.sauts ?? 0) + 1 };
  return { ...campagne, entrees: [...autres.slice(0, dernier + 1), deplacee, ...autres.slice(dernier + 1)] };
}

/** Retire un prospect de la file : il ne sera pas appelé dans cette campagne. */
export function retirer(campagne: Campagne, prospectId: string, trace: TraceGeste): Campagne {
  entreeAAppeler(campagne, prospectId);
  return remplacerEntree(campagne, prospectId, { prospectId, etat: 'retiree', motif: 'retrait', ...trace });
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
 * Termine la campagne avant la fin : chaque prospect encore à appeler est retiré. Sans appel en cours, elle est
 * terminée tout de suite ; sinon l'appel va à son terme et `terminerAppel` la termine.
 */
export function terminerAvantLaFin(campagne: Campagne, trace: TraceGeste): Campagne {
  if (campagne.statut === 'terminee') throw new TransitionInvalide('la campagne est déjà terminée');
  if (!suivant(campagne)) throw new TransitionInvalide('plus aucun prospect à appeler : la campagne se termine avec l’appel en cours');
  return avecStatutAJour({
    ...campagne,
    entrees: campagne.entrees.map((e) => (e.etat === 'a-appeler' ? { prospectId: e.prospectId, etat: 'retiree', motif: 'fin-anticipee', ...trace } : e)),
  });
}
