import { exigerOperateur } from '@/lib/garde';
import { relayerFluxPont } from '@/lib/pont';

/** Écoute d'un appel téléphone en cours : prospect et Mina mélangés, PCM 16 bits mono, taux dans `x-taux`. */
export async function GET(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigerOperateur();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  return relayerFluxPont(`/appels/${id}/ecoute`, requete, { 'content-type': 'application/octet-stream' });
}
