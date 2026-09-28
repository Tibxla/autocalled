import { proposerPourAppel, reserverPourAppel } from '@/lib/agenda';
import { refusPont, requeteDuPont } from '@/lib/pont';

/** Outils d'agenda de Mina pendant un appel téléphone : les mêmes que sur la ligne navigateur (app/appels/outils.ts). */
export async function POST(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requeteDuPont(requete)) return refusPont();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ erreur: 'appel inconnu' }, { status: 404 });
  const { outil, parametres = {} } = (await requete.json()) as { outil?: string; parametres?: Record<string, unknown> };
  let resultat: unknown;
  if (outil === 'proposer_creneaux') resultat = await proposerPourAppel(id);
  else if (outil === 'reserver_creneau') resultat = await reserverPourAppel(id, parametres.debut, parametres.email, parametres.adresse_confirmee);
  else return Response.json({ erreur: 'outil inconnu' }, { status: 400 });
  return Response.json({ resultat: JSON.stringify(resultat) });
}
