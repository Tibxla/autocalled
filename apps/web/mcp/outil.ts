import type { CallToolResult, InputRequiredResult, McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { db } from '@/db';
import { journalMcp } from '@/db/schema';

/**
 * Déclaration des outils du serveur MCP (ADR 0009). Toute déclaration passe par ici, pour qu'aucun outil
 * n'échappe au journal : chaque appel laisse une ligne dans `journal_mcp`, lectures comprises.
 */

export type Confirmation = 'acceptee' | 'refusee' | 'indisponible';

/** Ce que rend un outil : un résultat, un refus (même phrase que l'interface), ou une demande de confirmation. */
export type Issue =
  | { ok: true; donnees: unknown; confirmation?: Confirmation; complement?: string }
  | { ok: false; raison: string; confirmation?: Confirmation }
  | { demande: InputRequiredResult };

export const reussite = (donnees: unknown, extra: { confirmation?: Confirmation; complement?: string } = {}): Issue => ({ ok: true, donnees, ...extra });
export const refus = (raison: string, confirmation?: Confirmation): Issue => ({ ok: false, raison, confirmation });

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

async function noter(
  outil: string,
  args: Record<string, unknown>,
  resultat: 'ok' | 'refus' | 'erreur' | 'confirmation-demandee',
  message: string | null,
  confirmation: Confirmation | null,
): Promise<void> {
  try {
    await db.insert(journalMcp).values({ outil, arguments: args, resultat, message, confirmation });
  } catch (erreur) {
    // Le journal ne doit pas faire échouer l'outil ; stdout est au protocole, l'erreur part sur stderr.
    console.error('journal MCP indisponible :', erreur);
  }
}

const texte = (t: string) => ({ type: 'text' as const, text: t });

export function declarateur(serveur: McpServer): Declarer {
  return (nom, config, traiter) => {
    const rappel = async (args: z.output<typeof config.entree>, ctx: ServerContext): Promise<CallToolResult | InputRequiredResult> => {
      const journal = config.resumer ? config.resumer(args) : (args as Record<string, unknown>);
      let issue: Issue;
      try {
        issue = await traiter(args, ctx);
      } catch (erreur) {
        const message = (erreur as Error).message;
        await noter(nom, journal, 'erreur', message, null);
        return { isError: true, content: [texte(`Erreur interne : ${message}`)] };
      }
      if ('demande' in issue) {
        await noter(nom, journal, 'confirmation-demandee', null, null);
        return issue.demande;
      }
      if (!issue.ok) {
        await noter(nom, journal, 'refus', issue.raison, issue.confirmation ?? null);
        return { isError: true, content: [texte(issue.raison)] };
      }
      await noter(nom, journal, 'ok', null, issue.confirmation ?? null);
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
