import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { modifierProspect, obstacleSuppressionProspect, revoquerNumero, supprimerProspect } from '@/lib/prospects';
import { patchFicheSchema } from '@/lib/schemas';
import { champEntreprise, champProspect, entrepriseInconnue, prospectInconnu } from './communs';
import { confirmer, refusDeConfirmation } from './confirmation';
import { type Declarer, refus, reussite } from './outil';

/** Les gestes sur la fiche d'un prospect et le consentement de son numéro. L'import est dans configuration.ts. */
export function outilsDeProspects(declarer: Declarer, serveur: McpServer): void {
  declarer(
    'modifier_prospect',
    {
      description:
        'Corrige la fiche d’un prospect, champ par champ (nom, societe, role, telephone, email, contexte ; null efface un champ facultatif). Mêmes contrôles et même régime qu’un réimport de la fiche : un nouveau numéro est enregistré comme consentant (sauf s’il a été révoqué) et sera signalé « ajouté par le MCP » à la confirmation d’un appel. L’identifiant (nom du fichier) ne change jamais. Aucun texte de tiers dans le contexte sans la demande de l’opérateur.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        prospect: champProspect,
        champs: patchFicheSchema,
        connu: z.iso.datetime({ offset: true }).optional().describe('Le `majLe` rendu par lire_prospect : refus si la fiche a changé depuis.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      // La fiche est déjà dans la table prospects : le journal ne garde que les champs touchés.
      resumer: ({ entreprise, prospect, champs, connu }) => ({ entreprise, prospect, champs: Object.keys(champs), connu }),
    },
    async ({ entreprise: slug, prospect: id, champs, connu }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const r = await modifierProspect(e.id, id, champs, { canal: 'mcp', connu: connu ?? null });
      if (!r.ok) return refus(r.raison);
      const apres = await trouverProspect(e.id, id);
      return reussite({ prospect: id, majLe: apres?.majLe ?? null, rapport: r.rapport });
    },
  );

  declarer(
    'supprimer_prospect',
    {
      description:
        'Supprime définitivement la fiche d’un prospect. Ses appels et bilans restent (un réimport du même fichier les retrouve), et le consentement de son numéro aussi : pour ne plus jamais l’appeler, revoquer_numero d’abord. Refusé tant qu’il attend dans la file d’une campagne ou qu’un appel avec lui est en cours. Demande la confirmation de l’opérateur.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ entreprise: slug, prospect: id }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const p = await trouverProspect(e.id, id);
      if (!p) return refus(prospectInconnu(id));
      const obstacle = await obstacleSuppressionProspect(e.id, p.id);
      if (obstacle) return refus(obstacle);
      const [nAppels, autorisations] = await Promise.all([
        db.$count(appels, and(eq(appels.entrepriseId, e.id), eq(appels.prospectId, p.id))),
        autorisationsDe([p.telephone]),
      ]);
      const numero = numeroLisible(p.telephone);
      const garde = await confirmer(
        serveur,
        ctx,
        `Supprimer définitivement la fiche de ${p.nom}${p.societe ? ` (${p.societe})` : ''} dans l’entreprise ${e.nom}. ${
          nAppels ? `Ses ${nAppels} appel${nAppels > 1 ? 's gardent leur' : ' garde son'} bilan, sans fiche.` : 'Aucun appel ne lui est rattaché.'
        } ${
          autorisations.get(p.telephone)?.autorise
            ? `Le numéro ${numero} reste autorisé : revoquer_numero pour ne plus jamais l’appeler.`
            : `Le numéro ${numero} n’est pas autorisé : il ne sera pas appelé.`
        }`,
        ['supprimer_prospect', e.id, p.id, p.majLe.toISOString(), nAppels],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      const r = await supprimerProspect(e.id, p.id);
      return r.ok ? reussite({ prospect: p.id, supprime: true, appelsGardes: r.appelsGardes }) : refus(r.raison);
    },
  );

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
      const [partages, dansLEntreprise] = await Promise.all([
        db.$count(prospects, eq(prospects.telephone, p.telephone)),
        db.$count(prospects, and(eq(prospects.entrepriseId, e.id), eq(prospects.telephone, p.telephone))),
      ]);
      const garde = await confirmer(
        serveur,
        ctx,
        `Révoquer définitivement le numéro ${numeroLisible(p.telephone)} de ${p.nom} (${e.nom}) : il ne sera plus jamais appelé${partages > 1 ? `, pour les ${partages} prospects qui le partagent` : ''}, et aucun import ne le réautorisera.`,
        ['revoquer_numero', p.telephone, partages],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      const consentementsClos = await revoquerNumero(p.telephone);
      return reussite(
        { numero: numeroLisible(p.telephone), revoque: true, consentementsClos, prospectsTouches: { entreprise: dansLEntreprise, toutes: partages } },
        { confirmation: 'acceptee' },
      );
    },
  );
}
