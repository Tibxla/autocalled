import { lireCatalogueAssistante } from '@/lib/catalogue-assistante';
import { estOperateur, identiteAppelant } from '@/lib/operateur';

export async function GET(requete: Request) {
  if (!estOperateur(identiteAppelant(requete.headers))) return Response.json({ raison: 'Accès réservé à l’opérateur.' }, { status: 403 });
  return Response.json(await lireCatalogueAssistante(), { headers: { 'cache-control': 'no-store' } });
}
