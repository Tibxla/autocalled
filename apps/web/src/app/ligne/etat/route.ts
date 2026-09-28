import { exigerOperateur } from '@/lib/garde';
import { commanderPont } from '@/lib/pont';

/** État de la ligne téléphone pour l'indicateur de la barre du haut, relu toutes les quelques secondes. */
export async function GET() {
  await exigerOperateur();
  const etat = await commanderPont('/etat');
  if (!etat.ok) return Response.json({ pont: false }, { headers: { 'cache-control': 'no-store' } });
  const { connecte, appelEnCours, appelId } = etat.corps as { connecte?: boolean; appelEnCours?: boolean; appelId?: string | null };
  return Response.json(
    { pont: true, connecte: Boolean(connecte), appelEnCours: Boolean(appelEnCours), appelId: appelId ?? null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
