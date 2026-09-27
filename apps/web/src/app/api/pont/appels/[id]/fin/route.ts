import { TransitionInvalide } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { traiterAppel } from '@/lib/appels';
import { appelerSuivantTelephone, clore, PAUSE_ENTRE_APPELS_MS } from '@/lib/campagnes';
import { refusPont, requeteDuPont } from '@/lib/pont';

/**
 * Fin d'un appel téléphone. Avec une conversation, le bilan suit le même chemin que la ligne navigateur ;
 * sans conversation (pas de décroché, ou canal son jamais ouvert), l'appel est clos tel quel.
 */
export async function POST(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requeteDuPont(requete)) return refusPont();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ erreur: 'appel inconnu' }, { status: 404 });
  const fin = (await requete.json()) as { raison?: string; conversationId?: string | null };
  const [appel] = await db.select({ conversationId: appels.conversationId, campagneId: appels.campagneId }).from(appels).where(eq(appels.id, id));
  if (!appel) return Response.json({ erreur: 'appel inconnu' }, { status: 404 });

  const conversationId = appel.conversationId ?? fin.conversationId ?? null;
  if (conversationId) {
    await db.update(appels).set({ conversationId, finLe: new Date() }).where(eq(appels.id, id));
    after(() => traiterAppel(id));
  } else if (fin.raison === 'canal son absent') {
    await db
      .update(appels)
      .set({ finLe: new Date(), statut: 'echec', erreur: 'Le téléphone passerelle n’a pas ouvert le canal son, même après reconnexion.' })
      .where(eq(appels.id, id));
  } else {
    await db.update(appels).set({ finLe: new Date(), statut: 'termine', issue: 'non-abouti' }).where(eq(appels.id, id));
  }
  // Appel de campagne : on clôt son entrée et on enchaîne sur le prospect suivant.
  const campagneId = appel.campagneId;
  if (campagneId) {
    after(async () => {
      try {
        await clore(campagneId, id);
      } catch (erreur) {
        if (!(erreur instanceof TransitionInvalide)) throw erreur; // déjà close (entrée reprise à la main)
      }
      await new Promise((r) => setTimeout(r, PAUSE_ENTRE_APPELS_MS));
      await appelerSuivantTelephone(campagneId);
    });
  }
  return Response.json({ ok: true });
}
