import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { dossierDonnees } from '@/lib/appels';
import { exigerOperateur } from '@/lib/garde';

/** Sert l'enregistrement d'un appel, avec les requêtes partielles qui permettent de se déplacer dans l'audio. */
export async function GET(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigerOperateur();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const [appel] = await db.select({ audio: appels.audio }).from(appels).where(eq(appels.id, id));
  if (!appel?.audio) return new Response(null, { status: 404 });

  const racine = dossierDonnees();
  const chemin = normalize(join(racine, appel.audio));
  if (!chemin.startsWith(normalize(racine))) return new Response(null, { status: 404 });
  const { size: taille } = await stat(chemin);

  const plage = /bytes=(\d*)-(\d*)/.exec(requete.headers.get('range') ?? '');
  const debut = plage?.[1] ? Number(plage[1]) : 0;
  const fin = plage?.[2] ? Math.min(Number(plage[2]), taille - 1) : taille - 1;
  const flux = Readable.toWeb(createReadStream(chemin, { start: debut, end: fin })) as ReadableStream;
  return new Response(flux, {
    status: plage ? 206 : 200,
    headers: {
      'content-type': 'audio/mpeg',
      'accept-ranges': 'bytes',
      'content-length': String(fin - debut + 1),
      ...(plage ? { 'content-range': `bytes ${debut}-${fin}/${taille}` } : {}),
      'cache-control': 'private, max-age=3600',
    },
  });
}
