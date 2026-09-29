import { exigerOperateur } from '@/lib/garde';
import { etatPourLaBarre } from '@/lib/ligne';

/** État de la ligne pour la barre du haut, relu toutes les 3 s : voir `etatPourLaBarre`. */
export async function GET() {
  await exigerOperateur();
  return Response.json(await etatPourLaBarre(), { headers: { 'cache-control': 'no-store' } });
}
