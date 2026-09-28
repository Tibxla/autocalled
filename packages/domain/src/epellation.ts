/**
 * Épellation d'une adresse e-mail à relire au prospect avant de réserver : c'est le code qui la produit, à
 * partir de l'adresse qui sera réellement utilisée, pour que Mina ne relise jamais autre chose que ce qui
 * partira (appel du 28/09 : une lettre ajoutée par la reconnaissance vocale, adresse réservée sans relecture).
 */

/** Domaines que tout le monde dit en mots : les épeler lettre par lettre n'apporte rien. */
const DOMAINES_COURANTS = new Set([
  'gmail',
  'hotmail',
  'outlook',
  'live',
  'yahoo',
  'icloud',
  'orange',
  'wanadoo',
  'free',
  'sfr',
  'laposte',
  'bbox',
]);

const SIGNES: Record<string, string> = { '.': 'point', '-': 'tiret', _: 'tiret bas', '+': 'plus' };

function lettreParLettre(texte: string): string {
  return [...texte].map((c) => SIGNES[c] ?? c.toUpperCase()).join(', ');
}

export function epelerAdresse(adresse: string): string {
  const [local = '', domaine = ''] = adresse.trim().toLowerCase().split('@');
  const [nom = '', ...extension] = domaine.split('.');
  const courant = DOMAINES_COURANTS.has(nom);
  const extensionDite = extension.map((e) => `point ${e}`).join(' ');
  // Après un domaine épelé, la virgule garde la même pause qu'entre les lettres.
  const suite = extensionDite ? `${courant ? ' ' : ', '}${extensionDite}` : '';
  return `${lettreParLettre(local)}, arobase ${courant ? nom : lettreParLettre(nom)}${suite}`;
}
