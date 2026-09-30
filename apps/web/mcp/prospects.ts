import { normaliserNumero } from '@autocalled/domain';
import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { MENTION_NEUTRE, effacerPersonne, inventaireEffacement, phrasesEffacement } from '@/lib/effacement';
import { numeroLisible } from '@/lib/format';
import { archiverProspect, filesEnAttente, filesTelephoneEnCours, modifierProspect, reactiverProspect, revoquerNumero } from '@/lib/prospects';
import { patchFicheSchema } from '@/lib/schemas';
import { champEntreprise, champProspect, entrepriseInconnue, prospectInconnu } from './communs';
import { champ, citation, confirmer, heureDeParis, refusDeConfirmation } from './confirmation';
import { type Declarer, refus, reussite } from './outil';

/** Les champs d'une fiche que l'assistante reçoit, hors numéro. */
const TEXTES_DITS = ['nom', 'societe', 'role', 'contexte'] as const;

/**
 * Les gestes sur la fiche d'un prospect et le consentement de son numéro : corriger, archiver et réactiver, effacer la
 * personne (ADR 0013), révoquer. L'import est dans configuration.ts.
 */
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
    'archiver_prospect',
    {
      description:
        'Archive un prospect : il sort de lister_prospects (sauf `archives: true`) et des choix de campagne, et ne peut plus être appelé ni ajouté à une campagne tant qu’il l’est. Ses appels, bilans et le consentement de son numéro restent ; reactiver_prospect le fait revenir. C’est un frein, réversible, sans confirmation, sauf s’il attend dans la file d’une campagne non terminée : il en serait retiré (motif retrait) sans y revenir à la réactivation, donc l’opérateur confirme, sur la question qui nomme ces campagnes. Refusé pendant un appel avec lui. Pour qu’une personne ne soit plus jamais appelée : revoquer_numero ; pour l’effacer entièrement : effacer_personne.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async ({ entreprise: slug, prospect: id }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const p = await trouverProspect(e.id, id);
      if (!p) return refus(prospectInconnu(id));
      // Lu ici pour la question ; archiverProspect relit les files sous verrou et refuse une file qui n'y figurait pas.
      const files = p.archiveLe ? [] : await filesEnAttente(e.id, id);
      let confirmation: 'acceptee' | undefined;
      if (files.length) {
        const garde = await confirmer(
          serveur,
          ctx,
          `Retirer ${champ(p.nom)}${p.societe ? ` (${champ(p.societe)})` : ''}, de l’entreprise ${champ(e.nom)}, de la file ${
            files.length > 1 ? `de ${files.length} campagnes` : 'd’une campagne'
          } où ce prospect attend d’être appelé, et l’archiver : ${files.map((f) => `${f.libelle}${f.derniere ? ' (plus personne d’autre à y appeler : elle se terminera)' : ''}`).join(' ; ')}. Il n’y sera pas appelé, et le retrait ne se défait pas : réactivé, il ne revient dans aucune file.`,
          ['archiver_prospect', e.id, id, files.map((f) => f.id)],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const r = await archiverProspect(
        e.id,
        id,
        'mcp',
        files.map((f) => f.id),
      );
      if (!r.ok) return refus(r.raison, confirmation);
      return reussite(
        {
          prospect: id,
          archive: true,
          dejaArchive: r.deja,
          retireDesFiles: r.retireDe,
          ...(r.terminees.length ? { campagnesTerminees: r.terminees } : {}),
        },
        { confirmation },
      );
    },
  );

  declarer(
    'reactiver_prospect',
    {
      description:
        'Réactive un prospect archivé : il revient dans les listes et peut de nouveau être appelé ou ajouté à une campagne (son numéro doit toujours être autorisé). Il ne revient dans aucune file de campagne.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async ({ entreprise: slug, prospect: id }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const r = await reactiverProspect(e.id, id);
      return r.ok ? reussite({ prospect: id, archive: false, dejaActif: r.deja }) : refus(r.raison);
    },
  );

  declarer(
    'effacer_personne',
    {
      description:
        'Efface entièrement une personne, à sa demande (droit à l’effacement) : sa fiche, ses appels avec transcriptions et bilans, ses enregistrements sur le disque, ses rendez-vous et leurs événements Google Agenda quand l’API le permet, ses entrées de campagne, ses rappels, le consentement de son numéro et ses mentions dans le journal MCP. Seule reste l’empreinte irréversible du numéro dans la liste d’opposition : il ne sera plus jamais appelé ni importé, pour aucun prospect. Les autres prospects qui portent le même numéro ne sont pas effacés (la question les nomme) mais ne sont plus appelables. Refusé pendant un appel avec elle, pendant le rapatriement d’un de ses enregistrements ou l’inscription d’un de ses rendez-vous, et sans SEL_OPPOSITION dans le .env. Irréversible : demande la confirmation de l’opérateur, avec la liste de ce qui sera effacé. Le résultat rend ce qui reste à faire à la main (événements Google, conversations ElevenLabs, fichiers en échec).',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      // L'identifiant de la personne ne reste pas au journal : la ligne du succès s'écrit après l'effacement, qui
      // neutralise les lignes précédentes (dont la question posée à l'opérateur).
      resumer: ({ entreprise }) => ({ entreprise, prospect: MENTION_NEUTRE }),
    },
    async ({ entreprise: slug, prospect: id }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const inv = await inventaireEffacement(e.id, id);
      if (!inv) return refus(prospectInconnu(id));
      if (inv.obstacle) return refus(inv.obstacle);
      const { efface, reste } = phrasesEffacement(inv, (t) => champ(t, 40));
      const garde = await confirmer(
        serveur,
        ctx,
        `Effacer définitivement ${champ(inv.prospect.nom)}${inv.prospect.societe ? ` (${champ(inv.prospect.societe)})` : ''}, ${inv.prospect.numeroLisible}, de l’entreprise ${champ(e.nom)}. Seront effacés : ${efface.join(' ; ')}. ${reste.join(' ')}`,
        [
          'effacer_personne',
          e.id,
          inv.prospect.id,
          inv.prospect.numero,
          inv.appels,
          inv.rendezVous,
          inv.evenements,
          inv.entreesCampagne,
          inv.consentements,
          inv.autresPorteurs.map((a) => `${a.entreprise}/${a.prospect}`),
        ],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      const r = await effacerPersonne(e.id, inv.prospect.id, 'mcp');
      if (!r.ok) return refus(r.raison, 'acceptee');
      return reussite(
        {
          efface: r.efface,
          ...(r.fichiersEnEchec.length ? { fichiersEnEchec: r.fichiersEnEchec } : {}),
          evenementsASupprimerALaMain: r.evenementsASupprimer,
          conversationsElevenLabsASupprimer: r.conversationsElevenLabs,
          autresPorteursDuNumero: r.autresPorteurs.map((a) => ({ entreprise: a.entreprise, prospect: a.prospect })),
          numero: 'en opposition : plus jamais appelé ni importé',
        },
        { confirmation: 'acceptee' },
      );
    },
  );

  declarer(
    'revoquer_numero',
    {
      description:
        'Révoque définitivement le consentement d’un numéro, pour tous les prospects qui le partagent et toutes les entreprises : il ne sera plus jamais appelé, et aucun import ne le réautorisera. Soit `entreprise` et `prospect` (le numéro est lu dans la fiche), soit `numero` seul, pour un numéro dont aucune fiche ne porte plus (lire_consentements le retrouve). Demande la confirmation de l’opérateur.',
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
