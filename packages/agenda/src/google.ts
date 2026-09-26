/**
 * Client minimal de Google Agenda (OAuth « application Web » et API Calendar v3), sans dépendance.
 * Portées limitées au nécessaire : lire les disponibilités de tous les calendriers (freebusy), lister
 * les calendriers, et gérer uniquement le calendrier que l'application a créé (app.created).
 */
export const PORTEES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
  'openid',
  'email',
];

export interface ClientOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function urlConsentement(client: ClientOAuth, etat: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: PORTEES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: etat,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function jetons(corps: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; id_token?: string }> {
  const reponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corps),
  });
  if (!reponse.ok) throw new Error(`Google OAuth ${reponse.status} : ${(await reponse.text()).slice(0, 200)}`);
  return reponse.json() as Promise<{ access_token: string; refresh_token?: string; id_token?: string }>;
}

export async function echangerCode(client: ClientOAuth, code: string) {
  const r = await jetons({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!r.refresh_token) throw new Error('Google n’a pas renvoyé de jeton de rafraîchissement');
  const email = r.id_token ? (JSON.parse(Buffer.from(r.id_token.split('.')[1] ?? '', 'base64url').toString()) as { email?: string }).email : undefined;
  return { refreshToken: r.refresh_token, accessToken: r.access_token, email: email ?? null };
}

export async function jetonAcces(client: Omit<ClientOAuth, 'redirectUri'>, refreshToken: string): Promise<string> {
  const r = await jetons({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  return r.access_token;
}

async function api<T>(acces: string, chemin: string, init: RequestInit = {}): Promise<T> {
  const reponse = await fetch(`https://www.googleapis.com/calendar/v3${chemin}`, {
    ...init,
    headers: { authorization: `Bearer ${acces}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!reponse.ok) throw new Error(`Google Agenda ${reponse.status} : ${(await reponse.text()).slice(0, 200)}`);
  return reponse.json() as Promise<T>;
}

export async function listerCalendriers(acces: string): Promise<{ id: string; nom: string }[]> {
  const r = await api<{ items: { id: string; summary: string; selected?: boolean }[] }>(acces, '/users/me/calendarList');
  return r.items.map((c) => ({ id: c.id, nom: c.summary }));
}

export async function creerCalendrier(acces: string, nom: string, fuseau: string): Promise<string> {
  const r = await api<{ id: string }>(acces, '/calendars', { method: 'POST', body: JSON.stringify({ summary: nom, timeZone: fuseau }) });
  return r.id;
}

/** Plages occupées sur l'ensemble des calendriers donnés. */
export async function occupations(acces: string, calendriers: string[], debut: Date, fin: Date): Promise<{ debut: Date; fin: Date }[]> {
  const r = await api<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(acces, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: debut.toISOString(), timeMax: fin.toISOString(), items: calendriers.map((id) => ({ id })) }),
  });
  return Object.values(r.calendars).flatMap((c) => c.busy.map((b) => ({ debut: new Date(b.start), fin: new Date(b.end) })));
}

/** Crée l'événement avec un lien Google Meet ; si un invité est donné, Google lui envoie l'invitation. */
export async function creerEvenement(
  acces: string,
  calendrier: string,
  evenement: { debut: Date; fin: Date; titre: string; description: string; invite?: string | null },
): Promise<{ id: string; lienVisio: string | null }> {
  const envoi = evenement.invite ? 'all' : 'none';
  const r = await api<{ id: string; hangoutLink?: string }>(
    acces,
    `/calendars/${encodeURIComponent(calendrier)}/events?conferenceDataVersion=1&sendUpdates=${envoi}`,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: evenement.titre,
        description: evenement.description,
        start: { dateTime: evenement.debut.toISOString() },
        end: { dateTime: evenement.fin.toISOString() },
        attendees: evenement.invite ? [{ email: evenement.invite }] : [],
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      }),
    },
  );
  return { id: r.id, lienVisio: r.hangoutLink ?? null };
}
