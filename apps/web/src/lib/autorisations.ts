import 'server-only';
import { type Autorisation, type Consentement, type NumeroE164, verifierAutorisation } from '@autocalled/domain';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { consentements } from '@/db/schema';
import { numerosOpposes } from './opposition';

/**
 * État d'autorisation de chaque numéro, calculé par le domaine à partir des consentements en base, après la liste
 * d'opposition (ADR 0013) : un numéro effacé n'est jamais autorisé, et si la liste ne se lit plus, aucun ne l'est.
 * Tout appel passe par ici (`preparerAppel`), juste avant de composer.
 */
export async function autorisationsDe(numeros: string[]): Promise<Map<string, Autorisation>> {
  const uniques = [...new Set(numeros)];
  if (uniques.length === 0) return new Map();
  const [lignes, opposes] = await Promise.all([db.select().from(consentements).where(inArray(consentements.numero, uniques)), numerosOpposes(uniques)]);
  const tous: Consentement[] = lignes.map((c) => ({
    numero: c.numero as NumeroE164,
    texteVersion: c.texteVersion,
    source: { type: 'import', importId: c.importId },
    accordeLe: c.accordeLe,
    revoqueLe: c.revoqueLe,
  }));
  const maintenant = new Date();
  return new Map(
    uniques.map((n): [string, Autorisation] => [
      n,
      opposes === 'illisible'
        ? { autorise: false, raison: 'opposition-illisible' }
        : opposes.has(n)
          ? { autorise: false, raison: 'numero-efface' }
          : verifierAutorisation(n, tous, maintenant),
    ]),
  );
}
