import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** « +33639980001 » → « 06 39 98 00 01 » pour un numéro français, format international sinon. */
export function numeroLisible(e164: string): string {
  const numero = parsePhoneNumberFromString(e164);
  if (!numero) return e164;
  return numero.country === 'FR' ? numero.formatNational() : numero.formatInternational();
}
