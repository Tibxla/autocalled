import type { McpServer } from '@modelcontextprotocol/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { revoquerNumero } from '@/lib/prospects';
import { champEntreprise, champProspect, entrepriseInconnue, prospectInconnu } from './communs';
import { confirmer, refusDeConfirmation } from './confirmation';
import { type Declarer, refus, reussite } from './outil';

export function outilsDeProspects(declarer: Declarer, serveur: McpServer): void {
  declarer(
    'revoquer_numero',
    {
      description:
        'Révoque définitivement le consentement du numéro d’un prospect, pour tous les prospects qui le partagent et toutes les entreprises : il ne sera plus jamais appelé, et aucun import ne le réautorisera. Le numéro est lu dans la fiche, jamais saisi. Demande la confirmation de l’opérateur.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ entreprise: slug, prospect: id }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const p = await trouverProspect(e.id, id);
      if (!p) return refus(prospectInconnu(id));
      if (!(await autorisationsDe([p.telephone])).get(p.telephone)?.autorise) return refus('Ce numéro n’a aucun consentement actif : rien à révoquer.');
      const partages = await db.$count(prospects, eq(prospects.telephone, p.telephone));
      const garde = confirmer(
        serveur,
        ctx,
        `Révoquer définitivement le numéro ${numeroLisible(p.telephone)} de ${p.nom} (${e.nom}) : il ne sera plus jamais appelé${partages > 1 ? `, pour les ${partages} prospects qui le partagent` : ''}, et aucun import ne le réautorisera.`,
        ['revoquer_numero', p.telephone, partages],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      await revoquerNumero(p.telephone);
      return reussite({ numero: numeroLisible(p.telephone), revoque: true, prospectsTouches: partages }, { confirmation: 'acceptee' });
    },
  );
}
