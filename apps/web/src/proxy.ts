import { type NextRequest, NextResponse } from 'next/server';
import { estOperateur, identiteAppelant, requeteLocaleDirecte } from './lib/operateur';

const texte = { 'content-type': 'text/plain; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/pont/')) {
    // Le pont rappelle l'application en direct sur 127.0.0.1, sans identité Tailscale : ses routes vérifient le
    // secret du pont (ADR 0007). Rien ne les sert à travers `tailscale serve`, qui les publierait au tailnet.
    if (requeteLocaleDirecte(request.headers)) return NextResponse.next();
    return new NextResponse('Introuvable.', { status: 404, headers: texte });
  }
  if (estOperateur(identiteAppelant(request.headers))) return NextResponse.next();
  return new NextResponse('Accès réservé à l’opérateur.', { status: 403, headers: texte });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
