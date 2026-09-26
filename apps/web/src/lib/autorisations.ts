import 'server-only';
import { type Autorisation, type Consentement, type NumeroE164, verifierAutorisation } from '@autocalled/domain';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { consentements } from '@/db/schema';

/** État d'autorisation de chaque numéro, calculé par le domaine à partir des consentements en base. */
export async function autorisationsDe(numeros: string[]): Promise<Map<string, Autorisation>> {
  const uniques = [...new Set(numeros)];
  if (uniques.length === 0) return new Map();
  const lignes = await db.select().from(consentements).where(inArray(consentements.numero, uniques));
  const tous: Consentement[] = lignes.map((c) => ({
    numero: c.numero as NumeroE164,
    texteVersion: c.texteVersion,
    source: { type: 'import', importId: c.importId },
    accordeLe: c.accordeLe,
    revoqueLe: c.revoqueLe,
  }));
  const maintenant = new Date();
  return new Map(uniques.map((n) => [n, verifierAutorisation(n, tous, maintenant)]));
}
