/**
 * Authentification par l'identité Tailscale (ADR 0006). L'application n'écoute que sur 127.0.0.1 :
 * seul `tailscale serve` l'atteint, et il pose lui-même l'en-tête `Tailscale-User-Login`.
 *
 * Deux gardes complètent l'en-tête d'identité :
 * - l'hôte demandé (`Host`, qu'un navigateur ne laisse pas forger) doit être celui de `ORIGINE_APP` ou une adresse
 *   de bouclage : une page qui se fait résoudre vers 127.0.0.1 (rebinding DNS) arrive avec son propre nom et
 *   est refusée, même si elle pose un `Tailscale-User-Login` ;
 * - l'identité simulée du développement ne vaut que pour une requête locale directe, jamais pour une requête
 *   relayée par `tailscale serve` (nœud tagué, Funnel), qui n'aurait sinon aucune identité à présenter.
 */
export const EN_TETE_IDENTITE = 'tailscale-user-login';

/** En-têtes posés par un mandataire (`tailscale serve` ajoute au moins les `x-forwarded-*`). */
const EN_TETES_MANDATAIRE = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-funnel-request'];

/** Nom d'hôte sans port, en minuscules, crochets IPv6 compris (`[::1]`). */
function nomDHote(hote: string): string {
  const h = hote.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0] ?? '';
}

export function estHoteLocal(hote: string | null): boolean {
  if (!hote) return false;
  return ['127.0.0.1', 'localhost', '[::1]'].includes(nomDHote(hote));
}

/** Hôte attendu de l'interface (`ORIGINE_APP`), ou `null` s'il n'est pas configuré ou illisible. */
function hoteDeLApplication(): string | null {
  try {
    return process.env.ORIGINE_APP ? new URL(process.env.ORIGINE_APP).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Vrai si l'hôte demandé est celui de l'interface sur le tailnet, ou une adresse de bouclage. */
export function hoteAutorise(entetes: Headers): boolean {
  const hote = entetes.get('host')?.trim().toLowerCase();
  if (!hote) return false;
  if (estHoteLocal(hote)) return true;
  const attendu = hoteDeLApplication();
  return attendu !== null && hote === attendu;
}

/** Vrai si la requête arrive directement sur 127.0.0.1, sans passer par `tailscale serve` ni aucun mandataire. */
export function requeteLocaleDirecte(entetes: Headers): boolean {
  if (EN_TETES_MANDATAIRE.some((e) => entetes.has(e)) || entetes.has(EN_TETE_IDENTITE)) return false;
  return estHoteLocal(entetes.get('host'));
}

/**
 * Identité de l'appelant, ou `null`. En développement, une identité simulée remplace l'en-tête absent, mais
 * seulement pour une requête locale directe (voir en tête).
 */
export function identiteAppelant(entetes: Headers): string | null {
  if (!hoteAutorise(entetes)) return null;
  const login = entetes.get(EN_TETE_IDENTITE);
  if (login) return login;
  if (process.env.NODE_ENV === 'development' && requeteLocaleDirecte(entetes)) return process.env.OPERATEUR_DEV_LOGIN || null;
  return null;
}

export function estOperateur(login: string | null): boolean {
  const attendu = process.env.OPERATEUR_TAILSCALE_LOGIN;
  if (!attendu || !login) return false;
  return login.toLowerCase() === attendu.toLowerCase();
}
