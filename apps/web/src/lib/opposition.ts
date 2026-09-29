import 'server-only';
import { createHmac } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { type Origine, oppositions } from '@/db/schema';

/**
 * Liste d'opposition (ADR 0013). Effacer une personne supprime son consentement, qui est une donnée personnelle, mais
 * l'interdiction de la rappeler doit survivre : on garde l'empreinte irréversible de son numéro, un HMAC-SHA256 au
 * sel secret de l'installation (`SEL_OPPOSITION`, hors base). Sans le sel, une empreinte ne se retrouve pas à partir
 * d'un numéro, et la table seule ne dit aucun numéro.
 *
 * Le sel ne change jamais : changé ou perdu, les empreintes ne se retrouvent plus. La ligne témoin (empreinte d'une
 * constante) le détecte, et tant qu'elle ne se retrouve pas, aucun numéro n'est autorisé ni importé (`illisible`).
 */

const TEMOIN = 'autocalled:temoin-de-la-liste-d-opposition';
const SEL_MIN = 32;

export const SEL_ABSENT =
  'SEL_OPPOSITION manque dans le .env (32 caractères au moins, openssl rand -hex 32) : sans lui, un numéro effacé ne pourrait plus être reconnu. Rien n’est effacé.';

export const OPPOSITION_ILLISIBLE =
  'La liste d’opposition ne se lit plus : SEL_OPPOSITION manque ou a changé depuis le premier effacement. Remets sa valeur d’origine dans le .env ; d’ici là, aucun numéro n’est appelé ni importé.';

/** Le sel de l'installation, ou null s'il manque ou est trop court. */
export function selOpposition(): string | null {
  const sel = process.env.SEL_OPPOSITION?.trim();
  return sel && sel.length >= SEL_MIN ? sel : null;
}

function empreinte(valeur: string, sel: string): string {
  return createHmac('sha256', sel).update(valeur).digest('hex');
}

/** L'empreinte d'un numéro E.164 : irréversible sans le sel. */
export function empreinteNumero(numero: string, sel: string): string {
  return empreinte(`numero:${numero}`, sel);
}

type Lecteur = Pick<typeof db, 'select'>;
type Ecrivain = Pick<typeof db, 'insert'>;

/**
 * Parmi ces numéros (E.164), ceux qui sont en opposition ; `illisible` si la liste ne peut pas être consultée (sel
 * absent ou changé alors qu'elle n'est pas vide). Une liste vide n'exige pas de sel : une installation qui n'a jamais
 * effacé personne n'a rien à configurer.
 */
export async function numerosOpposes(numeros: readonly string[], lecteur: Lecteur = db): Promise<Set<string> | 'illisible'> {
  const sel = selOpposition();
  if (!sel) {
    const [ligne] = await lecteur.select({ e: oppositions.empreinte }).from(oppositions).limit(1);
    return ligne ? 'illisible' : new Set();
  }
  const temoin = empreinte(TEMOIN, sel);
  const parEmpreinte = new Map([...new Set(numeros)].map((n) => [empreinteNumero(n, sel), n]));
  const lignes = await lecteur
    .select({ empreinte: oppositions.empreinte, temoin: oppositions.temoin })
    .from(oppositions)
    .where(parEmpreinte.size ? or(eq(oppositions.temoin, true), inArray(oppositions.empreinte, [...parEmpreinte.keys()])) : eq(oppositions.temoin, true));
  const temoins = lignes.filter((l) => l.temoin);
  if (temoins.length === 0) {
    // Pas de témoin : la liste doit être vide (il est écrit avec la première opposition, dans la même transaction).
    const [ligne] = await lecteur.select({ e: oppositions.empreinte }).from(oppositions).limit(1);
    if (ligne) return 'illisible';
  } else if (!temoins.some((t) => t.empreinte === temoin)) {
    return 'illisible';
  }
  const opposes = new Set<string>();
  for (const l of lignes) {
    const numero = l.temoin ? undefined : parEmpreinte.get(l.empreinte);
    if (numero) opposes.add(numero);
  }
  return opposes;
}

/**
 * Inscrit un numéro dans la liste d'opposition (avec le témoin s'il n'y est pas encore), dans la transaction de
 * l'effacement. `bilan` : les comptes de ce qui a été effacé, sans donnée personnelle.
 */
export async function inscrireOpposition(tx: Ecrivain, numero: string, sel: string, par: Origine, bilan: Record<string, number>): Promise<void> {
  await tx.insert(oppositions).values({ empreinte: empreinte(TEMOIN, sel), temoin: true }).onConflictDoNothing();
  await tx
    .insert(oppositions)
    .values({ empreinte: empreinteNumero(numero, sel), par, bilan })
    .onConflictDoUpdate({ target: oppositions.empreinte, set: { le: new Date(), par, bilan } });
}
