import { deciderEntrant } from '@/lib/entrants';
import { refusPont, requeteDuPont } from '@/lib/pont';

/**
 * Un appel entrant sonne sur le téléphone passerelle : le pont demande s'il décroche (ADR 0018), avec le numéro brut
 * de l'appelant. `{decrocher: true, appelId, …}` : l'appel est déjà enregistré, sa fin arrivera par la route de fin
 * comme pour un appel sortant. `{decrocher: false}` : le téléphone sonne jusqu'à la messagerie, rien n'est écrit.
 */
export async function POST(requete: Request) {
  if (!requeteDuPont(requete)) return refusPont();
  const corps = (await requete.json().catch(() => null)) as { numero?: unknown } | null;
  return Response.json(await deciderEntrant(corps?.numero));
}
