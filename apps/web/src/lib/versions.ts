import 'server-only';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { scripts, versionsScript } from '@/db/schema';

/** Toutes les versions de script d'une entreprise, la plus récente de chaque script en premier. */
export async function versionsDeLEntreprise(entrepriseId: string) {
  const lignes = await db
    .select({ id: versionsScript.id, numero: versionsScript.numero, script: scripts.nom, scriptId: scripts.id })
    .from(versionsScript)
    .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(eq(scripts.entrepriseId, entrepriseId))
    .orderBy(asc(scripts.creeLe), desc(versionsScript.numero));
  return lignes.map((l) => ({ ...l, libelle: `${l.script} · v${l.numero}` }));
}
