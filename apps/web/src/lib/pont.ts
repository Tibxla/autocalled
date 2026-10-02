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

/** `statut` : le code HTTP d'un refus du pont (409 : ligne occupée) ; absent s'il n'a pas répondu. */
export type ReponsePont = { ok: true; corps: Record<string, unknown> } | { ok: false; raison: string; statut?: number };

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
    if (!r.ok) return { ok: false, raison: typeof lu.erreur === 'string' ? lu.erreur : `Le pont répond ${r.status}.`, statut: r.status };
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

/**
 * Ce que la ligne téléphone permet à cet instant, d'après le pont : `absente` (le pont ne répond pas), `occupee` (un
 * appel en ligne, sortant ou entrant, même s'il sonne encore), `plafond` (plafond d'appels atteint), sinon `libre`.
 */
export type DisponibiliteLigne =
  | { type: 'absente' | 'plafond'; raison: string }
  /** `plafond` : la raison si le plafond est atteint en plus, sinon null. */
  | { type: 'occupee'; raison: string; plafond: string | null }
  | { type: 'libre' };

export async function disponibiliteLigne(): Promise<DisponibiliteLigne> {
  const etat = await commanderPont('/etat');
  if (!etat.ok) return { type: 'absente', raison: etat.raison };
  const c = etat.corps;
  const plafond = typeof c.plafond === 'string' ? c.plafond : null;
  if (c.appelEnCours || c.entrantEnCours || typeof c.appelId === 'string') return { type: 'occupee', raison: APPEL_DEJA_EN_LIGNE, plafond };
  return plafond ? { type: 'plafond', raison: plafond } : { type: 'libre' };
}

/** La raison si le plafond d'appels du pont est atteint (ou si le pont ne répond pas, ou, avec `ligneLibre`, si un appel est en ligne), sinon null. */
export async function refusDuPont({ ligneLibre = false }: { ligneLibre?: boolean } = {}): Promise<string | null> {
  const ligne = await disponibiliteLigne();
  // Un appel isolé ne part pas sur une ligne occupée : refusé avant d'être enregistré, il ne laisse pas de « Non composé ».
  if (ligne.type === 'occupee') return ligneLibre ? ligne.raison : ligne.plafond;
  return ligne.type === 'libre' ? null : ligne.raison;
}

export const APPEL_DEJA_EN_LIGNE = 'Un appel est déjà en ligne sur le téléphone.';

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
