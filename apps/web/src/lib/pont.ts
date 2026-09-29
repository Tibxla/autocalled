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

export type ReglagesLigne = { appelsParHeure: number; appelsParJour: number; pauseEntreAppelsS: number };

/** Réglages de la ligne téléphone, gardés par le pont ; null s'il ne répond pas. */
export async function reglagesDuPont(): Promise<ReglagesLigne | null> {
  const etat = await commanderPont('/etat');
  return etat.ok ? ((etat.corps.reglages as ReglagesLigne | undefined) ?? null) : null;
}

/** La raison si le plafond d'appels du pont est atteint (ou si le pont ne répond pas), sinon null. */
export async function refusDuPont(): Promise<string | null> {
  const etat = await commanderPont('/etat');
  if (!etat.ok) return etat.raison;
  return typeof etat.corps.plafond === 'string' ? etat.corps.plafond : null;
}

/**
 * Relance la liaison Bluetooth du téléphone passerelle (liaison figée, téléphone revenu à portée). Ne compose rien ;
 * refusé pendant un appel, que la relance couperait.
 */
export async function reconnecterTelephone(): Promise<ReponsePont> {
  const etat = await commanderPont('/etat');
  if (!etat.ok) return etat;
  if (etat.corps.appelEnCours) return { ok: false, raison: 'Un appel est en cours sur le téléphone : la reconnexion le couperait. Attends qu’il finisse.' };
  return commanderPont('/telephone/reconnecter', {});
}

/**
 * Relaie un flux du pont (fil d'un appel, écoute) à l'opérateur. Ces routes restent derrière l'identité
 * Tailscale : le navigateur ne parle jamais directement au pont.
 */
export async function relayerFluxPont(chemin: string, requete: Request, entetes: Record<string, string>): Promise<Response> {
  const base = process.env.PONT_URL ?? 'http://127.0.0.1:3021';
  try {
    const dernier = requete.headers.get('last-event-id');
    const r = await fetch(`${base}${chemin}`, {
      headers: { authorization: `Bearer ${secret()}`, ...(dernier ? { 'last-event-id': dernier } : {}) },
      signal: requete.signal,
      cache: 'no-store',
    });
    if (!r.ok || !r.body) return new Response(null, { status: r.status === 404 ? 404 : 502 });
    const taux = r.headers.get('x-taux');
    return new Response(r.body, {
      headers: { ...entetes, 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no', ...(taux ? { 'x-taux': taux } : {}) },
    });
  } catch {
    return new Response(null, { status: 502 });
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
