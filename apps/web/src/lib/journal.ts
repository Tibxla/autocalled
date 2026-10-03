import 'server-only';
import { db } from '@/db';
import { journalMcp, type Origine } from '@/db/schema';

/**
 * L'écriture du journal des gestes (ADR 0016), commune au serveur MCP (mcp/outil.ts) et à la page Assistante
 * (lib/edition-assistante.ts) : une seule table, `journal_mcp`, un seul format de ligne, l'origine en plus.
 */

export type ResultatJournal = 'ok' | 'refus' | 'erreur' | 'confirmation-demandee';
export type ConfirmationJournal = 'acceptee' | 'refusee' | 'indisponible' | 'sans-question';

export interface LigneAEcrire {
  origine: Origine;
  /** Le nom de l'outil du MCP, ou celui de l'outil qui fait le même geste pour la page. */
  outil: string;
  /** Les arguments reçus, ou leur résumé quand ils sont volumineux ou personnels. */
  arguments: Record<string, unknown>;
  resultat: ResultatJournal;
  /** Un refus ou une erreur : la raison ; une confirmation demandée : la question ; un succès : un résumé, ou rien. */
  message: string | null;
  confirmation: ConfirmationJournal | null;
}

/** Le texte d'une question gardé au journal : ce que l'opérateur a lu avant d'accepter ou de refuser. */
export const QUESTION_MAX = 2000;

/**
 * Écrit une ligne ; faux si la base la refuse. Ne lève jamais : une lecture ne doit pas échouer pour le journal. Un
 * geste sous confirmation, lui, ne part pas sans sa ligne `confirmation-demandee` : c'est à l'appelant de s'arrêter.
 */
export async function noterAuJournal(ligne: LigneAEcrire): Promise<boolean> {
  try {
    await db.insert(journalMcp).values({
      ...ligne,
      message: ligne.resultat === 'confirmation-demandee' ? (ligne.message?.slice(0, QUESTION_MAX) ?? null) : ligne.message,
    });
    return true;
  } catch (erreur) {
    // Le serveur MCP parle sur stdout : l'erreur part sur stderr, là comme dans Next.
    console.error('journal des gestes indisponible :', erreur);
    return false;
  }
}
