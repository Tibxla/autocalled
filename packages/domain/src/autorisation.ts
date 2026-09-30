import { type NumeroE164, normaliserNumero } from './numero.ts';

/**
 * Accord d'une personne pour être appelée par une IA et enregistrée (ADR 0001).
 * Il n'est jamais modifié : une révocation renseigne `revoqueLe`, un nouvel accord crée un nouveau consentement.
 */
export interface Consentement {
  numero: NumeroE164;
  /** Version du texte de consentement que la personne a accepté. */
  texteVersion: number;
  source: { type: 'import'; importId: string };
  accordeLe: Date;
  revoqueLe: Date | null;
}

/**
 * Numéro qui vient de passer la vérification d'autorisation. Une ligne ne compose que ce type :
 * seul `verifierAutorisation` peut le produire, donc aucun chemin ne compose sans vérifier.
 */
export type NumeroAutorise = NumeroE164 & { readonly __autorise: true };

/**
 * `numero-efface` : la personne a été effacée, son numéro est dans la liste d'opposition (plus aucun consentement ne
 * vaut). `opposition-illisible` : la liste d'opposition ne se lit plus (sel absent ou changé) ; par prudence, aucun
 * numéro n'est autorisé. Ces deux raisons viennent de l'application, qui seule connaît la liste.
 */
export type RaisonRefus = 'numero-invalide' | 'aucun-consentement' | 'consentement-revoque' | 'numero-efface' | 'opposition-illisible';

export type Autorisation =
  | { autorise: true; numero: NumeroAutorise; consentement: Consentement }
  | { autorise: false; raison: RaisonRefus };

function estActif(consentement: Consentement, maintenant: Date): boolean {
  if (consentement.accordeLe > maintenant) return false;
  return consentement.revoqueLe === null || consentement.revoqueLe > maintenant;
}

/** À appeler juste avant de composer, jamais en avance : un consentement peut être révoqué entre-temps. */
export function verifierAutorisation(
  numeroBrut: string,
  consentements: readonly Consentement[],
  maintenant: Date,
): Autorisation {
  const numero = normaliserNumero(numeroBrut);
  if (!numero) return { autorise: false, raison: 'numero-invalide' };

  const duNumero = consentements.filter((c) => c.numero === numero);
  const actif = duNumero
    .filter((c) => estActif(c, maintenant))
    .sort((a, b) => b.accordeLe.getTime() - a.accordeLe.getTime())[0];

  if (actif) return { autorise: true, numero: numero as NumeroAutorise, consentement: actif };

  const revoque = duNumero.some((c) => c.revoqueLe !== null && c.revoqueLe <= maintenant);
  return { autorise: false, raison: revoque ? 'consentement-revoque' : 'aucun-consentement' };
}

export interface NumerosDUnImport {
  aAutoriser: NumeroE164[];
  dejaAutorises: NumeroE164[];
  revoques: NumeroE164[];
}

/**
 * Tri des numéros d'un import, à partir des consentements déjà en base pour ces numéros. Un numéro jamais
 * vu reçoit le consentement de l'import ; un numéro qui en a déjà un le garde. Un numéro révoqué ne l'est
 * jamais à nouveau par un import : le texte de consentement promet qu'il ne sera « plus jamais appelé ».
 */
export function numerosAAutoriser(
  numeros: readonly NumeroE164[],
  connus: readonly { numero: string; revoqueLe: Date | null }[],
): NumerosDUnImport {
  const tri: NumerosDUnImport = { aAutoriser: [], dejaAutorises: [], revoques: [] };
  for (const numero of new Set(numeros)) {
    const duNumero = connus.filter((c) => c.numero === numero);
    if (duNumero.some((c) => c.revoqueLe !== null)) tri.revoques.push(numero);
    else if (duNumero.length > 0) tri.dejaAutorises.push(numero);
    else tri.aAutoriser.push(numero);
  }
  return tri;
}
