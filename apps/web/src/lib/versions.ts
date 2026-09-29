import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes, scripts, versionsScript } from '@/db/schema';

/**
 * Toutes les versions de script d'une entreprise, la plus récente de chaque script en premier, scripts archivés
 * compris (`scriptArchive`) : les appels et les campagnes passés y font référence.
 */
export async function versionsDeLEntreprise(entrepriseId: string) {
  const lignes = await db
    .select({ id: versionsScript.id, numero: versionsScript.numero, script: scripts.nom, scriptId: scripts.id, scriptArchive: scripts.archive })
    .from(versionsScript)
    .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(eq(scripts.entrepriseId, entrepriseId))
    .orderBy(asc(scripts.creeLe), desc(versionsScript.numero));
  return lignes.map((l) => ({ ...l, libelle: `${l.script} · v${l.numero}` }));
}

/** Les versions proposées pour lancer un appel ou une campagne : celles des scripts non archivés, même ordre. */
export async function versionsLancables(entrepriseId: string) {
  return (await versionsDeLEntreprise(entrepriseId)).filter((v) => !v.scriptArchive);
}

/**
 * Ce qui utilise encore un script : campagnes en cours ou suspendues, appels en ligne, sur l'une de ses versions.
 * L'archivage ne les arrête pas ; l'interface demande confirmation seulement dans ce cas.
 */
export async function usageDuScript(scriptId: string): Promise<{ campagnes: number; appelsEnCours: number }> {
  const versions = db.select({ id: versionsScript.id }).from(versionsScript).where(eq(versionsScript.scriptId, scriptId));
  const [[c], [a]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(campagnes)
      .where(and(inArray(campagnes.versionScriptId, versions), inArray(campagnes.statut, ['en-cours', 'en-pause']))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(appels)
      .where(and(inArray(appels.versionScriptId, versions), eq(appels.statut, 'en-cours'))),
  ]);
  return { campagnes: c?.n ?? 0, appelsEnCours: a?.n ?? 0 };
}
