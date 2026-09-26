/**
 * Authentification par l'identité Tailscale (ADR 0006). L'application n'écoute que sur 127.0.0.1 :
 * seul `tailscale serve` l'atteint, et il pose lui-même l'en-tête `Tailscale-User-Login`.
 */
export const EN_TETE_IDENTITE = 'tailscale-user-login';

/** Identité de l'appelant, ou `null`. En développement, une identité simulée remplace l'en-tête absent. */
export function identiteAppelant(entetes: Headers): string | null {
  const login = entetes.get(EN_TETE_IDENTITE);
  if (login) return login;
  if (process.env.NODE_ENV === 'development') return process.env.OPERATEUR_DEV_LOGIN || null;
  return null;
}

export function estOperateur(login: string | null): boolean {
  const attendu = process.env.OPERATEUR_TAILSCALE_LOGIN;
  if (!attendu || !login) return false;
  return login.toLowerCase() === attendu.toLowerCase();
}
