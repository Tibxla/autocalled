import 'server-only';
import { type Appelabilite, verifierNumero } from '@autocalled/domain';
import { numerosOpposes } from './opposition';

/**
 * Pour chaque numéro, s'il peut être composé : valide, et absent de la liste d'opposition (ADR 0013). Si la liste ne
 * se lit plus, aucun ne l'est. L'opérateur garantit que la personne est prévenue (ADR 0001). Tout appel passe par ici
 * (`preparerAppel`), juste avant de composer.
 */
export async function appelabiliteDe(numeros: string[]): Promise<Map<string, Appelabilite>> {
  const uniques = [...new Set(numeros)];
  if (uniques.length === 0) return new Map();
  const opposes = await numerosOpposes(uniques);
  return new Map(uniques.map((n): [string, Appelabilite] => [n, verifierNumero(n, opposes)]));
}
