import { TransitionInvalide } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { traiterAppel } from '@/lib/appels';
import { appelerSuivantTelephone, clore, pauseEntreAppelsMs } from '@/lib/campagnes';
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
  } else if (fin.raison === 'canal son absent' || fin.raison === 'composition impossible' || fin.raison === 'plafond atteint') {
    const erreur =
      fin.raison === 'canal son absent'
        ? 'Le téléphone passerelle n’a pas ouvert le canal son, même après reconnexion.'
        : fin.raison === 'plafond atteint'
          ? 'Plafond d’appels atteint avant la recomposition : l’appel n’est pas reparti (chaque composition compte).'
          : 'Le téléphone passerelle n’a pas composé, même après reconnexion : vérifie qu’il est allumé et à portée (page Téléphone).';
    await db.update(appels).set({ finLe: new Date(), statut: 'echec', erreur }).where(eq(appels.id, id));
  } else {
    // Pas de bilan, mais une issue système : les lectures (listes, filtres, analyse) comptent l'appel.
    await db.update(appels).set({ finLe: new Date(), statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti' }).where(eq(appels.id, id));
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
      const pause = await pauseEntreAppelsMs();
      await new Promise((r) => setTimeout(r, pause));
      await appelerSuivantTelephone(campagneId);
    });
  }
  return Response.json({ ok: true });
}
