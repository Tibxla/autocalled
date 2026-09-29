import { normaliserNumero } from '@autocalled/domain';
import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { filesTelephoneEnCours, modifierProspect, obstacleSuppressionProspect, revoquerNumero, supprimerProspect } from '@/lib/prospects';
import { patchFicheSchema } from '@/lib/schemas';
import { champEntreprise, champProspect, entrepriseInconnue, prospectInconnu } from './communs';
import { champ, citation, confirmer, heureDeParis, refusDeConfirmation } from './confirmation';
import { type Declarer, refus, reussite } from './outil';

/** Les champs d'une fiche que l'assistante reçoit, hors numéro. */
const TEXTES_DITS = ['nom', 'societe', 'role', 'contexte'] as const;

/** Les gestes sur la fiche d'un prospect et le consentement de son numéro. L'import est dans configuration.ts. */
export function outilsDeProspects(declarer: Declarer, serveur: McpServer): void {
  declarer(
    'modifier_prospect',
    {
      description:
        'Corrige la fiche d’un prospect, champ par champ (nom, societe, role, telephone, email, contexte ; null efface un champ facultatif). Mêmes contrôles et même régime qu’un réimport de la fiche : un nouveau numéro est enregistré comme consentant (sauf s’il a été révoqué) et sera signalé « ajouté par le MCP » à la confirmation d’un appel. Changer le numéro, le nom, la société, le rôle ou le contexte d’un prospect qui attend dans une campagne téléphone en cours demande la confirmation de l’opérateur : l’assistante s’en servirait sans autre question. Sans `connu`, la fiche lue au début de l’outil sert de référence. L’identifiant (nom du fichier) ne change jamais. Aucun texte de tiers dans le contexte sans la demande de l’opérateur.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        prospect: champProspect,
        champs: patchFicheSchema,
        connu: z.iso.datetime({ offset: true }).optional().describe('Le `majLe` rendu par lire_prospect : refus si la fiche a changé depuis.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      // La fiche est déjà dans la table prospects : le journal ne garde que les champs touchés.
      // Un numéro changé y figure aussi (le nouveau ici, l'ancien et le nouveau dans le message du succès).
      resumer: ({ entreprise, prospect, champs, connu }) => ({
        entreprise,
        prospect,
        champs: Object.keys(champs),
        ...(champs.telephone !== undefined ? { telephone: champs.telephone } : {}),
        connu,
      }),
    },
    async ({ entreprise: slug, prospect: id, champs, connu }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const p = await trouverProspect(e.id, id);
      if (!p) return refus(prospectInconnu(id));
      // Sans `connu`, la fiche lue ici sert de référence : un réimport arrivé entre-temps n'est pas écrasé.
      const reference = connu ?? p.majLe.toISOString();
      let confirmation: 'acceptee' | undefined;
      const nouveau = champs.telephone === undefined ? null : normaliserNumero(champs.telephone);
      const numeroChange = nouveau !== null && nouveau !== p.telephone;
      const textesChanges = TEXTES_DITS.filter((k) => champs[k] !== undefined && (champs[k] ?? '') !== (p[k] ?? ''));
      if (numeroChange || textesChanges.length) {
        // Une campagne téléphone en cours compose le numéro de la fiche et donne sa fiche à l'assistante sans autre
        // question : changer l'un ou l'autre fait sonner un autre téléphone ou change ce qui est dit au prospect.
        const files = (await filesTelephoneEnCours(e.id, [p.id])).get(p.id);
        if (files?.length) {
          const changements = [
            numeroChange && `numéro ${numeroLisible(p.telephone)} → ${numeroLisible(nouveau)} (le nouveau numéro sera composé à son tour)`,
            ...textesChanges.map((k) => `${k} ${citation(p[k], 120)} → ${citation(champs[k], k === 'contexte' ? 600 : 120)}`),
          ].filter(Boolean);
          const garde = await confirmer(
            serveur,
            ctx,
            `Corriger la fiche de ${champ(p.nom)}${p.societe ? ` (${champ(p.societe)})` : ''}, ${champ(e.nom)}, qui attend dans la file de ${
              files.length > 1 ? `${files.length} campagnes téléphone en cours` : 'la campagne téléphone en cours'
            } (${files.join(', ')}) : ${changements.join(' ; ')}. L’assistante s’en servira à son appel, sans autre question. Nous sommes ${heureDeParis()}.`,
            ['modifier_prospect', e.id, p.id, p.telephone, nouveau, Object.fromEntries(textesChanges.map((k) => [k, champs[k]])), files, reference],
          );
          if (garde.etat === 'a-demander') return garde.issue;
          if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
          confirmation = 'acceptee';
        }
      }
      const r = await modifierProspect(e.id, id, champs, { canal: 'mcp', connu: reference });
      if (!r.ok) return refus(r.raison, confirmation);
      const apres = await trouverProspect(e.id, id);
      return reussite(
        { prospect: id, majLe: apres?.majLe ?? null, rapport: r.rapport },
        { confirmation, journal: numeroChange ? `numéro ${numeroLisible(p.telephone)} → ${numeroLisible(nouveau)}` : undefined },
      );
    },
  );

  declarer(
    'supprimer_prospect',
    {
      description:
        'Supprime définitivement la fiche d’un prospect. Ses appels et bilans restent (un réimport du même fichier les retrouve), et le consentement de son numéro aussi : pour ne plus jamais l’appeler, revoquer_numero (avant, ou après avec `numero`). Refusé tant qu’il attend dans la file d’une campagne, qu’un appel avec lui est en cours, ou qu’un de ses rendez-vous reste à inscrire dans Google Agenda (à créer, ou en échec : recreer_evenement d’abord). Demande la confirmation de l’opérateur.',
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
        `Supprimer définitivement la fiche de ${champ(p.nom)}${p.societe ? ` (${champ(p.societe)})` : ''} dans l’entreprise ${champ(e.nom)}. ${
          nAppels > 1 ? `Ses ${nAppels} appels gardent leur bilan, sans fiche.` : nAppels === 1 ? 'Son appel garde son bilan, sans fiche.' : 'Aucun appel ne lui est rattaché.'
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
        'Révoque définitivement le consentement d’un numéro, pour tous les prospects qui le partagent et toutes les entreprises : il ne sera plus jamais appelé, et aucun import ne le réautorisera. Soit `entreprise` et `prospect` (le numéro est lu dans la fiche), soit `numero` seul, pour un numéro dont la fiche a été supprimée (lire_consentements le retrouve). Demande la confirmation de l’opérateur.',
      entree: z
        .strictObject({
          entreprise: champEntreprise.optional(),
          prospect: champProspect.optional(),
          numero: z.string().min(1).max(30).optional().describe('Un numéro français (06…, +33…), à la place d’entreprise et prospect.'),
        })
        .refine(
          (r) => (r.numero !== undefined) !== (r.entreprise !== undefined || r.prospect !== undefined) && (r.numero !== undefined || (r.entreprise !== undefined && r.prospect !== undefined)),
          'Donne soit entreprise et prospect, soit numero.',
        ),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ entreprise: slug, prospect: id, numero: saisi }, ctx) => {
      let numero: string;
      let de = '';
      let entrepriseId: string | null = null;
      if (saisi !== undefined) {
        const n = normaliserNumero(saisi);
        if (!n) return refus(`Numéro illisible : « ${saisi} ». Un numéro français (06…, +33…).`);
        numero = n;
      } else {
        const e = await trouverEntreprise(slug!);
        if (!e) return refus(entrepriseInconnue(slug!));
        const p = await trouverProspect(e.id, id!);
        if (!p) return refus(prospectInconnu(id!));
        numero = p.telephone;
        de = ` de ${champ(p.nom)} (${champ(e.nom)})`;
        entrepriseId = e.id;
      }
      if (!(await autorisationsDe([numero])).get(numero)?.autorise) return refus('Ce numéro n’a aucun consentement actif : rien à révoquer.');
      const [partages, dansLEntreprise] = await Promise.all([
        db.$count(prospects, eq(prospects.telephone, numero)),
        entrepriseId ? db.$count(prospects, and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.telephone, numero))) : Promise.resolve(null),
      ]);
      const porteurs =
        partages > 1 ? `, pour les ${partages} prospects qui le partagent` : partages === 0 ? ' (aucune fiche ne le porte plus)' : saisi !== undefined ? ', pour le prospect qui le porte' : '';
      const garde = await confirmer(
        serveur,
        ctx,
        `Révoquer définitivement le numéro ${numeroLisible(numero)}${de} : il ne sera plus jamais appelé${porteurs}, et aucun import ne le réautorisera.`,
        ['revoquer_numero', numero, partages],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      const consentementsClos = await revoquerNumero(numero);
      return reussite(
        { numero: numeroLisible(numero), revoque: true, consentementsClos, prospectsTouches: { ...(dansLEntreprise !== null ? { entreprise: dansLEntreprise } : {}), toutes: partages } },
        { confirmation: 'acceptee' },
      );
    },
  );
}
