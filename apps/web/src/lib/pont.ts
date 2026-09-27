import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Pont Bluetooth (ADR 0007) : service local qui compose sur le téléphone passerelle. Les deux sens
 * s'authentifient par le même secret, `PONT_SECRET`, généré par scripts/installer-pont.sh.
 */
function secret(): string {
  const valeur = process.env.PONT_SECRET;
  if (!valeur) throw new Error("variable d'environnement manquante : PONT_SECRET");
  return valeur;
}

export type ReponsePont = { ok: true; corps: Record<string, unknown> } | { ok: false; raison: string };

export async function commanderPont(chemin: string, corps?: unknown): Promise<ReponsePont> {
  const base = process.env.PONT_URL ?? 'http://127.0.0.1:3021';
  try {
    const r = await fetch(`${base}${chemin}`, {
      method: corps === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${secret()}`, 'content-type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const lu = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, raison: typeof lu.erreur === 'string' ? lu.erreur : `Le pont répond ${r.status}.` };
    return { ok: true, corps: lu };
  } catch {
    return { ok: false, raison: 'Le pont Bluetooth ne répond pas : le service autocalled-pont tourne-t-il ?' };
  }
}

/** Les routes `/api/pont/…` ne passent pas par l'identité Tailscale : ce secret est leur seule garde. */
export function requeteDuPont(requete: Request): boolean {
  const recu = Buffer.from(requete.headers.get('authorization') ?? '');
  const attendu = Buffer.from(`Bearer ${secret()}`);
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

export function refusPont(): Response {
  return Response.json({ erreur: 'secret du pont absent ou faux' }, { status: 401 });
}
