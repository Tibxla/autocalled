/**
 * Imprime en JSON ce qu'il faut au pont Bluetooth pour appeler un prospect :
 * { numero, variables, motsCles, prepareLe }, vérifié par `preparerAppel` (numéro appelable, variables de Mina).
 * La sortie contient des données personnelles (numéro, contexte de la fiche) : le pont ne l'accepte que dix
 * minutes après `prepareLe` et l'efface après usage.
 *
 *   cd apps/web && node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts \
 *     scripts/variables-appel.ts <prospectId> [versionScriptId]
 *
 * Sans version de script, prend la plus récente de l'entreprise du prospect.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { prospects, scripts, versionsScript } from '@/db/schema';
import { preparerAppel } from '@/lib/appels';

const [prospectId, versionDemandee] = process.argv.slice(2);
if (!prospectId) {
  console.error('usage : variables-appel.ts <prospectId> [versionScriptId]');
  process.exit(2);
}
const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
if (!prospect) throw new Error('prospect introuvable');
const versionId =
  versionDemandee ??
  (
    await db
      .select({ id: versionsScript.id })
      .from(versionsScript)
      .innerJoin(scripts, eq(versionsScript.scriptId, scripts.id))
      .where(eq(scripts.entrepriseId, prospect.entrepriseId))
      .orderBy(desc(versionsScript.creeLe))
      .limit(1)
  )[0]?.id;
if (!versionId) throw new Error('aucune version de script pour cette entreprise');

const preparation = await preparerAppel(prospect.entrepriseId, prospectId, versionId);
if (!preparation.ok) {
  console.error(preparation.raison);
  process.exit(1);
}
const { numero, variables, motsCles, entrepriseId } = preparation;
console.log(JSON.stringify({ entrepriseId, prospectId, versionScriptId: versionId, numero, variables, motsCles, prepareLe: Date.now() }));
process.exit(0);
