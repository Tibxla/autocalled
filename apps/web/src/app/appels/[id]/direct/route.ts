import { exigerOperateur } from '@/lib/garde';
import { relayerFluxPont } from '@/lib/pont';

/** Fil d'un appel téléphone en cours (états, tours de parole), en SSE depuis le pont. */
export async function GET(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigerOperateur();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  return relayerFluxPont(`/appels/${id}/evenements`, requete, { 'content-type': 'text/event-stream; charset=utf-8' });
}
