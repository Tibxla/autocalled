import type { CallToolResult, InputRequiredResult, McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { type ConfirmationJournal, noterAuJournal, type ResultatJournal } from '@/lib/journal';

/**
 * Déclaration des outils du serveur MCP (ADR 0009). Toute déclaration passe par ici, pour qu'aucun outil
 * n'échappe au journal des gestes (ADR 0016) : chaque appel laisse une ligne d'origine `mcp` dans `journal_mcp`,
 * lectures comprises.
 */

export type Confirmation = ConfirmationJournal;

/**
 * Ce que rend un outil : un résultat, un refus (même phrase que l'interface), ou une demande de confirmation.
 * `journal` : une ligne de résumé gardée au journal pour un succès (versions avant et après d'une poussée…).
 */
export type Issue =
  | { ok: true; donnees: unknown; confirmation?: Confirmation; complement?: string; journal?: string }
  | { ok: false; raison: string; confirmation?: Confirmation }
  | { demande: InputRequiredResult; question?: string };

export const reussite = (donnees: unknown, extra: { confirmation?: Confirmation; complement?: string; journal?: string } = {}): Issue => ({
  ok: true,
  donnees,
  ...extra,
});
export const refus = (raison: string, confirmation?: Confirmation): Issue => ({ ok: false, raison, confirmation });

/** Le résultat positif d'une fonction de lib, sans son drapeau `ok`, tel qu'on le rend au modèle. */
export function sansOk(r: { ok: true }): Record<string, unknown> {
  const copie: Record<string, unknown> = { ...r };
  delete copie.ok;
  return copie;
}

/**
 * La réponse de l'opérateur pendant un passage d'un outil, posée par `confirmer` : elle reste au journal même si
 * l'outil échoue ensuite (un accord donné avant une exception doit se voir).
 */
const confirmations = new WeakMap<ServerContext, Confirmation>();

export function noterConfirmation(ctx: ServerContext, c: Confirmation): void {
  confirmations.set(ctx, c);
}

export type Declarer = <S extends z.ZodObject>(
  nom: string,
  config: {
    description: string;
    entree: S;
    annotations?: ToolAnnotations;
    /** Ce qui entre au journal à la place des arguments, quand ils sont volumineux ou personnels. */
    resumer?: (args: z.output<S>) => Record<string, unknown>;
  },
  traiter: (args: z.output<S>, ctx: ServerContext) => Promise<Issue>,
) => void;

function noter(outil: string, args: Record<string, unknown>, resultat: ResultatJournal, message: string | null, confirmation: Confirmation | null) {
  return noterAuJournal({ origine: 'mcp', outil, arguments: args, resultat, message, confirmation });
}

export const JOURNAL_INDISPONIBLE = 'Le journal des gestes est indisponible : un geste sous confirmation ne se fait pas sans trace. Rien n’a été fait.';

const texte = (t: string) => ({ type: 'text' as const, text: t });

/** Ce que voit le modèle d'une exception : ni texte Postgres, ni chemin de fichier, ni trace. Le détail va au journal. */
export const ERREUR_INTERNE = 'Erreur interne : l’outil a échoué (le détail est au journal des gestes).';

export function declarateur(serveur: McpServer): Declarer {
  return (nom, config, traiter) => {
    const rappel = async (args: z.output<typeof config.entree>, ctx: ServerContext): Promise<CallToolResult | InputRequiredResult> => {
      const journal = config.resumer ? config.resumer(args) : (args as Record<string, unknown>);
      let issue: Issue;
      try {
        issue = await traiter(args, ctx);
      } catch (erreur) {
        const message = erreur instanceof Error ? erreur.message : String(erreur);
        await noter(nom, journal, 'erreur', message, confirmations.get(ctx) ?? null);
        return { isError: true, content: [texte(ERREUR_INTERNE)] };
      }
      if ('demande' in issue) {
        // Un geste sous confirmation ne part jamais sans trace : pas de ligne au journal, pas de question, pas d'accord.
        if (!(await noter(nom, journal, 'confirmation-demandee', issue.question ?? null, null))) {
          return { isError: true, content: [texte(JOURNAL_INDISPONIBLE)] };
        }
        return issue.demande;
      }
      const confirmation = issue.confirmation ?? confirmations.get(ctx) ?? null;
      if (!issue.ok) {
        await noter(nom, journal, 'refus', issue.raison, confirmation);
        return { isError: true, content: [texte(issue.raison)] };
      }
      await noter(nom, journal, 'ok', issue.journal ?? null, confirmation);
      return {
        content: [texte(JSON.stringify(issue.donnees, null, 2)), ...(issue.complement ? [texte(issue.complement)] : [])],
      };
    };
    serveur.registerTool(
      nom,
      { description: config.description, inputSchema: config.entree, annotations: config.annotations },
      rappel as never,
    );
  };
}
