import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { refusPont, requeteDuPont } from '@/lib/pont';

/** Le pont annonce la conversation ElevenLabs dès son ouverture : sans elle, le bilan ne peut pas être rapatrié. */
export async function POST(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requeteDuPont(requete)) return refusPont();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ erreur: 'appel inconnu' }, { status: 404 });
  const { conversationId } = (await requete.json()) as { conversationId?: unknown };
  if (typeof conversationId !== 'string' || !conversationId) return Response.json({ erreur: 'conversationId requis' }, { status: 400 });
  await db.update(appels).set({ conversationId }).where(eq(appels.id, id));
  return Response.json({ ok: true });
}
