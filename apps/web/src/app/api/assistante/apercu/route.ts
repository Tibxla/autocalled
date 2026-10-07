import { apercuVoixSchema, genererApercuVoix } from '@/lib/catalogue-assistante';
import { estOperateur, identiteAppelant } from '@/lib/operateur';

export async function POST(requete: Request) {
  if (!estOperateur(identiteAppelant(requete.headers))) return Response.json({ raison: 'Accès réservé à l’opérateur.' }, { status: 403 });
  let memeOrigine = false;
  try {
    const origine = new URL(requete.headers.get('origin') ?? '');
    memeOrigine = ['https:', 'http:'].includes(origine.protocol) && origine.host === requete.headers.get('host');
  } catch { /* Une origine absente ou illisible est refusée. */ }
  if (!memeOrigine) return Response.json({ raison: 'Ouvre l’aperçu depuis l’interface.' }, { status: 403 });
  const texte = await requete.text();
  if (texte.length > 2_000) return Response.json({ raison: 'Réglages de voix illisibles.' }, { status: 400 });
  let corps: unknown;
  try { corps = JSON.parse(texte); } catch { corps = null; }
  const e = apercuVoixSchema.safeParse(corps);
  if (!e.success) return Response.json({ raison: e.error.issues[0]?.message ?? 'Réglages de voix illisibles.' }, { status: 400 });
  try {
    const audio = await genererApercuVoix(e.data);
    return new Response(audio, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ raison: 'Aperçu indisponible : vérifie que cette voix et ce modèle sont accessibles sur le compte ElevenLabs.' }, { status: 502 });
  }
}
