/**
 * Cycle de vie d'une campagne : ses prospects sont appelés l'un après l'autre, un seul appel à la
 * fois (il n'y a qu'un téléphone passerelle). Fonctions pures : chaque transition renvoie une
 * nouvelle campagne ou lève `TransitionInvalide`.
 */

export type StatutCampagne = 'prete' | 'en-cours' | 'en-pause' | 'terminee';

export type RaisonSaut = 'numero-non-autorise';

export type EntreeCampagne =
  | { prospectId: string; etat: 'a-appeler' }
  | { prospectId: string; etat: 'en-appel'; appelId: string }
  | { prospectId: string; etat: 'appelee'; appelId: string }
  | { prospectId: string; etat: 'sautee'; raisonSaut: RaisonSaut };

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
