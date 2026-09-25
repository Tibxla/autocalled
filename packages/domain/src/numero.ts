import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** Numéro de téléphone au format E.164 (`+33612345678`), seule forme stockée et comparée. */
export type NumeroE164 = string & { readonly __numero: 'E164' };

/**
 * Normalise une saisie libre en E.164. Sans indicatif, le numéro est lu comme français.
 * Renvoie `null` si ce n'est pas un numéro valide.
 */
export function normaliserNumero(brut: string): NumeroE164 | null {
  const numero = parsePhoneNumberFromString(brut, 'FR');
  if (!numero?.isValid()) return null;
  return numero.number as NumeroE164;
}
