import { type NumeroE164, normaliserNumero } from './numero.ts';

/**
 * Numéro qui vient de passer la vérification avant composition. Une ligne ne compose que ce type : seul
 * `verifierNumero` peut le produire, donc aucun chemin ne compose sans vérifier.
 */
export type NumeroAppelable = NumeroE164 & { readonly __appelable: true };

/**
 * `numero-efface` : la personne a été effacée, son numéro est dans la liste d'opposition (ADR 0013).
 * `opposition-illisible` : la liste d'opposition ne se lit plus (sel absent ou changé) ; par prudence, aucun numéro
 * n'est appelable. La liste vient de l'application, qui seule la connaît.
 */
export type RaisonRefus = 'numero-invalide' | 'numero-efface' | 'opposition-illisible';

export type Appelabilite = { appelable: true; numero: NumeroAppelable } | { appelable: false; raison: RaisonRefus };

/**
 * À appeler juste avant de composer, jamais en avance : une personne peut être effacée entre-temps. `opposes` : les
 * numéros (E.164) de la liste d'opposition parmi ceux qu'on vérifie, ou `illisible` si elle ne se lit plus. Rien
 * d'autre ne se vérifie : l'opérateur garantit n'appeler que des personnes prévenues (ADR 0001).
 */
export function verifierNumero(numeroBrut: string, opposes: ReadonlySet<string> | 'illisible'): Appelabilite {
  if (opposes === 'illisible') return { appelable: false, raison: 'opposition-illisible' };
  const numero = normaliserNumero(numeroBrut);
  if (!numero) return { appelable: false, raison: 'numero-invalide' };
  if (opposes.has(numero)) return { appelable: false, raison: 'numero-efface' };
  return { appelable: true, numero: numero as NumeroAppelable };
}
