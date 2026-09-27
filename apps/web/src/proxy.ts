import { type NextRequest, NextResponse } from 'next/server';
import { estOperateur, identiteAppelant } from './lib/operateur';

export function proxy(request: NextRequest) {
  // Le pont Bluetooth rappelle l'application sans identité Tailscale : ses routes vérifient le secret du pont (ADR 0007).
  if (request.nextUrl.pathname.startsWith('/api/pont/')) return NextResponse.next();
  if (estOperateur(identiteAppelant(request.headers))) return NextResponse.next();
  return new NextResponse('Accès réservé à l’opérateur.', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
