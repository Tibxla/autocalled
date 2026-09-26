import { randomBytes } from 'node:crypto';
import { urlConsentement } from '@autocalled/agenda';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clientGoogle } from '@/lib/google';
import { exigerOperateur } from '@/lib/garde';

export async function GET() {
  await exigerOperateur();
  const client = clientGoogle();
  if (!client) return new Response('Client OAuth Google non configuré (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ORIGINE_APP).', { status: 500 });
  const etat = randomBytes(24).toString('base64url');
  (await cookies()).set('etat_google', etat, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/google' });
  return NextResponse.redirect(urlConsentement(client, etat));
}
