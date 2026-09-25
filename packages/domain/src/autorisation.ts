import { type NumeroE164, normaliserNumero } from './numero.js';

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

export type Autorisation =
  | { autorise: true; numero: NumeroAutorise; consentement: Consentement }
  | { autorise: false; raison: 'numero-invalide' | 'aucun-consentement' | 'consentement-revoque' };

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
