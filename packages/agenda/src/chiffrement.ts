import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement AES-256-GCM du jeton de rafraîchissement Google stocké en base : une copie de la base
 * (sauvegarde, export) ne donne pas accès à l'agenda sans la clé, qui reste dans l'environnement.
 */
function cle(hex: string): Buffer {
  const octets = Buffer.from(hex, 'hex');
  if (octets.length !== 32) throw new Error('CLE_CHIFFREMENT doit faire 32 octets en hexadécimal (64 caractères)');
  return octets;
}

export function chiffrer(texte: string, cleHex: string): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', cle(cleHex), iv);
  const donnees = Buffer.concat([chiffreur.update(texte, 'utf8'), chiffreur.final()]);
  return [iv, chiffreur.getAuthTag(), donnees].map((b) => b.toString('base64url')).join('.');
}

export function dechiffrer(paquet: string, cleHex: string): string {
  const [iv, etiquette, donnees] = paquet.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !etiquette || !donnees) throw new Error('jeton chiffré illisible');
  const dechiffreur = createDecipheriv('aes-256-gcm', cle(cleHex), iv);
  dechiffreur.setAuthTag(etiquette);
  return Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()]).toString('utf8');
}
