import { TransitionInvalide } from '@autocalled/domain';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { traiterAppel } from '@/lib/appels';
import { annulerComposition, appelerSuivantTelephone, clore, pauseEntreAppelsMs, suspendrePourAssistanteIndisponible } from '@/lib/campagnes';
import { refusPont, requeteDuPont } from '@/lib/pont';
import { reveiller } from '@/lib/reveil';

/**
 * Fin d'un appel téléphone. Avec une conversation, le bilan suit le même chemin que la ligne navigateur ;
 * sans conversation (pas de décroché, ou canal son jamais ouvert), l'appel est clos tel quel.
 */
export async function POST(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requeteDuPont(requete)) return refusPont();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ erreur: 'appel inconnu' }, { status: 404 });
  const fin = (await requete.json()) as { raison?: string; conversationId?: string | null; sansParole?: boolean };
  const [appel] = await db
    .select({ conversationId: appels.conversationId, campagneId: appels.campagneId, sens: appels.sens })
    .from(appels)
    .where(eq(appels.id, id));
  if (!appel) return Response.json({ erreur: 'appel inconnu' }, { status: 404 });

  const conversationId = appel.conversationId ?? fin.conversationId ?? null;
  const indisponible = fin.raison === 'assistante indisponible';
  if (indisponible) {
    // Un entrant ou un rappel automatique peut révéler la panne avant la campagne elle-même.
    const concernees = appel.campagneId ? [{ id: appel.campagneId }] : await db.select({ id: campagnes.id }).from(campagnes)
      .where(and(eq(campagnes.ligne, 'bluetooth'), eq(campagnes.statut, 'en-cours')));
    for (const c of concernees) await suspendrePourAssistanteIndisponible(c.id, 'fin');
    if (!conversationId || fin.sansParole === true) {
      // Comme une composition défaite : annulerDebut garde la même tentative due (ADR 0017), sans bilan « Non abouti ».
      // Retirer aussi l'appel préserve un éventuel rappel convenu : tout sortant plus récent le solderait.
      if (appel.campagneId) await annulerComposition(appel.campagneId, id);
      else await db.delete(appels).where(eq(appels.id, id));
      return Response.json({ ok: true });
    }
  }
  if (conversationId) {
    await db.update(appels).set({ conversationId, finLe: new Date() }).where(eq(appels.id, id));
    // Un entrant passe son bilan avant toute relance (plus bas).
    if (appel.sens !== 'entrant') after(() => traiterAppel(id));
  } else if (fin.raison === 'canal son absent' || fin.raison === 'composition impossible' || fin.raison === 'plafond atteint') {
    const erreur =
      fin.raison === 'canal son absent'
        ? 'Le téléphone passerelle n’a pas ouvert le canal son, même après reconnexion.'
        : fin.raison === 'plafond atteint'
          ? 'Plafond d’appels atteint avant la recomposition : l’appel n’est pas reparti (chaque composition compte).'
          : 'Le téléphone passerelle n’a pas composé, même après reconnexion : vérifie qu’il est allumé et à portée (page Téléphone).';
    const issue = fin.raison === 'plafond atteint'
      ? { statut: 'echec' as const }
      : { statut: 'termine' as const, issue: 'non-abouti', issueSysteme: 'non-abouti' as const };
    await db.update(appels).set({ finLe: new Date(), ...issue, erreur }).where(eq(appels.id, id));
  } else {
    // Pas de bilan, mais une issue système : les lectures (listes, filtres, analyse) comptent l'appel. Un appel entrant
    // que le téléphone n'a pas pu décrocher (« décroché impossible ») finit ici aussi : aucune conversation.
    await db.update(appels).set({ finLe: new Date(), statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti' }).where(eq(appels.id, id));
  }
  // Appel de campagne : on clôt son entrée (sans réponse : nouvelle tentative prévue ; avec conversation : elle attend
  // son bilan, que traiterAppel classera) et on enchaîne sur le prospect suivant.
  const campagneId = appel.campagneId;
  if (appel.sens === 'entrant') {
    // Un appel entrant n'a pas d'entrée de file à clore. Il a pu retenir une campagne téléphone (ligne occupée) : après
    // la pause, celles qui ont quelqu'un à appeler repartent, comme au réveil. Son bilan d'abord : il retire la nouvelle
    // tentative du prospect qui vient de parler à l'assistante, que la relance composerait sinon aussitôt.
    after(async () => {
      try {
        if (conversationId) await traiterAppel(id);
      } finally {
        if (!indisponible) {
          const pause = await pauseEntreAppelsMs();
          await new Promise((r) => setTimeout(r, pause));
          await reveiller();
        }
      }
    });
  } else if (campagneId) {
    after(async () => {
      try {
        await clore(campagneId, id);
      } catch (erreur) {
        if (!(erreur instanceof TransitionInvalide)) throw erreur; // déjà close (entrée reprise à la main)
      }
      if (indisponible) return;
      const pause = await pauseEntreAppelsMs();
      await new Promise((r) => setTimeout(r, pause));
      await appelerSuivantTelephone(campagneId);
    });
  }
  return Response.json({ ok: true });
}
