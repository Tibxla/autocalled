import { type NextRequest, NextResponse } from 'next/server';
import { estOperateur, identiteAppelant } from './lib/operateur';

export function proxy(request: NextRequest) {
  if (estOperateur(identiteAppelant(request.headers))) return NextResponse.next();
  return new NextResponse('Accès réservé à l’opérateur.', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
