import { ISSUES_SYSTEME, TransitionInvalide, lireFiches } from '@autocalled/domain';
import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { campagnes, objections, prospects } from '@/db/schema';
import { PROSPECTS_ARCHIVES, enregistrerCampagne, suspendreSiEnCours } from '@/lib/campagnes';
import { trouverEntreprise } from '@/lib/donnees';
import * as entreprise from '@/lib/entreprises';
import { numeroLisible } from '@/lib/format';
import { FICHIERS_MAX, filesTelephoneEnCours, importerFiches } from '@/lib/prospects';
import { etapesSchema, type Fiche, ficheSchema, issueSchema, nomEntrepriseSchema, nomScriptSchema, objectionSchema, plagesSchema } from '@/lib/schemas';
import { usageDuScript } from '@/lib/versions';
import { champEntreprise, champVersion, entrepriseInconnue, SCRIPT_ARCHIVE, versionDeLEntreprise } from './communs';
import { champ, citation, confirmer, heureDeParis, refusDeConfirmation } from './confirmation';
import { avertissementCampagne, campagnesTelephoneEnCours } from './gardes-appel';
import { type Declarer, refus, reussite } from './outil';

/**
 * La configuration d'une entreprise (fiche, objections, issues, scripts), l'import des fiches prospect et la
 * préparation des campagnes. Toute écriture passe l'origine `mcp` en clair. Aucune ne fait sonner un téléphone ni
 * n'écrit à un prospect, sauf un import qui change le numéro d'un prospect en file d'une campagne téléphone en
 * cours : lui demande une confirmation, comme la suppression d'une entreprise vide, irréversible. Ce que l'assistante
 * dit au prospect (nom de l'entreprise, fiche, objections) demande aussi une confirmation quand le nom de l'entreprise
 * change, ou quand une campagne téléphone de l'entreprise tourne (ADR 0010, amendement).
 */

/** Écritures réversibles ou additives. */
const ECRITURE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const PAR_MCP = { origine: 'mcp' } as const;

/** La première erreur d'un schéma, dans les mots de l'interface. */
const premiereErreur = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join('.')} : ` : ''}${i.message}` : 'Saisie invalide.';
};

const connuHorodatage = z.iso.datetime({ offset: true }).optional();

export function outilsDeConfiguration(declarer: Declarer, serveur: McpServer): void {
  /* ------------------------------------------------------------------ entreprises */

  declarer(
    'creer_entreprise',
    { description: 'Crée une entreprise que l’assistante pourra représenter ; renvoie son identifiant (slug), figé ensuite.', entree: z.strictObject({ nom: nomEntrepriseSchema }), annotations: ECRITURE },
    async ({ nom }) => {
      const creee = await entreprise.creerEntreprise(nom);
      return creee.ok ? reussite({ entreprise: creee.slug }) : refus(creee.raison);
    },
  );

  declarer(
    'modifier_fiche_entreprise',
    {
      description:
        'Modifie la fiche d’une entreprise : seuls les champs donnés changent, le reste est gardé. `complements` : informations complémentaires, texte libre de 1 500 caractères au plus, que l’assistante n’emploie que si la conversation y mène. Un champ de texte vide (offre, cible, arguments, prixConsigne, interdits, complements) n’est pas transmis à l’assistante. `plages` remplace toutes les plages de rendez-vous (jour 1 = lundi … 7 = dimanche, heures HH:MM). Changer `nom` ne change pas l’identifiant (slug). `connu` : le `modifieLe` de lire_entreprise, refus si la fiche a changé depuis. Changer le nom (l’assistante se présente en son nom), ou tout champ de la fiche pendant une campagne téléphone en cours de l’entreprise, demande la confirmation de l’opérateur.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        champs: ficheSchema.partial().strict().default({}),
        plages: plagesSchema.optional(),
        connu: connuHorodatage,
      }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, champs, plages, connu }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      // Le patch est fusionné avec la fiche actuelle, puis validé par le même schéma que le formulaire.
      const fiche = ficheSchema.safeParse({ ...e, ...champs });
      if (!fiche.success) return refus(premiereErreur(fiche.error));
      const lesPlages = plagesSchema.safeParse(plages ?? e.plagesRendezVous);
      if (!lesPlages.success) return refus(premiereErreur(lesPlages.error));
      // Sans `connu`, la fiche lue au début de l'outil : rien n'est écrasé entre la lecture, la fusion et l'écriture.
      const reference = connu ?? e.modifieLe.toISOString();
      const changes = (Object.keys(fiche.data) as (keyof Fiche)[]).filter((k) => fiche.data[k] !== e[k]);
      const nomChange = changes.includes('nom');
      const enCours = changes.length ? await campagnesTelephoneEnCours(e.id) : [];
      let confirmation: 'acceptee' | undefined;
      if (nomChange || enCours.length) {
        const detail = changes.map((k) => `${k} ${citation(String(e[k]), 150)} → ${citation(String(fiche.data[k]), 500)}`).join(' ; ');
        const garde = await confirmer(
          serveur,
          ctx,
          `Modifier la fiche de ${champ(e.nom)} : ${detail}.${nomChange ? ' L’assistante se présente au nom de l’entreprise : le nouveau nom sera dit aux prospects dès le prochain appel.' : ''}${
            enCours.length ? ` ${avertissementCampagne(enCours)}` : ''
          }`,
          ['modifier_fiche_entreprise', e.id, reference, fiche.data, enCours],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const r = await entreprise.enregistrerFiche(e.id, fiche.data, lesPlages.data, { ...PAR_MCP, connu: reference });
      return r.ok
        ? reussite({ entreprise: e.slug, modifieLe: r.modifieLe, fiche: fiche.data, plagesRendezVous: lesPlages.data }, { confirmation })
        : refus(r.raison, confirmation);
    },
  );

  declarer(
    'supprimer_entreprise',
    {
      description:
        'Supprime définitivement une entreprise vide, créée par erreur (son slug est figé) : sa fiche, ses objections, ses issues personnalisées, ses scripts et leurs versions. Refusé dès qu’elle a un prospect, un import, un appel ou une campagne. Demande la confirmation de l’opérateur.',
      entree: z.strictObject({ entreprise: champEntreprise }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ entreprise: slug }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const contenu = await entreprise.contenuEntreprise(e.id);
      const obstacle = entreprise.obstacleSuppressionEntreprise(contenu);
      if (obstacle) return refus(obstacle);
      const c = contenu.configuration;
      const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
      const parties = [
        c.objections && pluriel(c.objections, 'objection'),
        c.issues && `${pluriel(c.issues, 'issue')} personnalisée${c.issues > 1 ? 's' : ''}`,
        c.scripts && `${pluriel(c.scripts, 'script')} (${pluriel(c.versions, 'version')})`,
      ].filter(Boolean);
      const garde = await confirmer(
        serveur,
        ctx,
        `Supprimer définitivement l’entreprise ${champ(e.nom)} (${e.slug}) et sa fiche${parties.length ? `, avec ${parties.join(', ')}` : ''}. Rien ne se récupère.`,
        ['supprimer_entreprise', e.id, c],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      const r = await entreprise.supprimerEntrepriseVide(e.id);
      return r.ok ? reussite({ entreprise: e.slug, supprimee: true, ...r.supprime }) : refus(r.raison);
    },
  );

  /* ------------------------------------------------------------------ objections */

  declarer(
    'enregistrer_objection',
    {
      description:
        'Ajoute une objection à une entreprise, avec sa réponse CRAC (creuser, reformuler, argumenter, contrôler), ou modifie celle dont on donne objectionId (les champs absents sont gardés). `connu` : son `modifieLe` lu dans lire_entreprise, refus si elle a changé depuis. Un libellé vient de l’opérateur, jamais recopié d’une transcription sans sa demande. Pendant une campagne téléphone en cours de l’entreprise, demande la confirmation de l’opérateur.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        objectionId: z.uuid().optional(),
        ...objectionSchema.partial().shape,
        connu: connuHorodatage,
      }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, objectionId, connu, ...champs }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      let actuelle: Partial<typeof objections.$inferSelect> = {};
      if (objectionId) {
        const [o] = await db.select().from(objections).where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, e.id)));
        if (!o) return refus('Cette objection n’existe pas dans cette entreprise.');
        actuelle = o;
      }
      const saisie = objectionSchema.safeParse({ creuser: '', reformuler: '', argumenter: '', controler: '', ...actuelle, ...champs });
      if (!saisie.success) return refus(premiereErreur(saisie.error));
      const reference = connu ?? actuelle.modifieLe?.toISOString() ?? null;
      const enCours = await campagnesTelephoneEnCours(e.id);
      let confirmation: 'acceptee' | undefined;
      if (enCours.length) {
        const o = saisie.data;
        const garde = await confirmer(
          serveur,
          ctx,
          `${objectionId ? 'Modifier' : 'Ajouter'} l’objection « ${champ(o.libelle, 160)} » de ${champ(e.nom)}. Creuser : « ${champ(o.creuser, 300)} » ; reformuler : « ${champ(o.reformuler, 300)} » ; argumenter : « ${champ(o.argumenter, 300)} » ; contrôler : « ${champ(o.controler, 300)} ». ${avertissementCampagne(enCours)}`,
          ['enregistrer_objection', e.id, objectionId ?? null, reference, o, enCours],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const r = await entreprise.enregistrerObjection(e.id, objectionId ?? null, saisie.data, { ...PAR_MCP, connu: reference });
      return r.ok ? reussite({ objectionId: r.id, ...saisie.data }, { confirmation }) : refus(r.raison, confirmation);
    },
  );

  declarer(
    'archiver_objection',
    {
      description:
        'Archive une objection (l’assistante ne la reçoit plus) ou la désarchive. Une objection n’est jamais supprimée : les bilans passés y font référence. Pendant une campagne téléphone en cours de l’entreprise, demande la confirmation de l’opérateur.',
      entree: z.strictObject({ entreprise: champEntreprise, objectionId: z.uuid(), archivee: z.boolean() }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, objectionId, archivee }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const [o] = await db.select().from(objections).where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, e.id)));
      if (!o) return refus('Cette objection n’existe pas dans cette entreprise.');
      const enCours = o.archivee !== archivee ? await campagnesTelephoneEnCours(e.id) : [];
      let confirmation: 'acceptee' | undefined;
      if (enCours.length) {
        const garde = await confirmer(
          serveur,
          ctx,
          `${archivee ? 'Archiver' : 'Désarchiver'} l’objection « ${champ(o.libelle, 160)} » de ${champ(e.nom)} : l’assistante ${archivee ? 'ne la recevra plus' : 'la recevra de nouveau'}. ${avertissementCampagne(enCours)}`,
          ['archiver_objection', e.id, objectionId, o.archivee, archivee, enCours],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      return (await entreprise.basculerArchiveObjection(e.id, objectionId, archivee, 'mcp'))
        ? reussite({ objectionId, archivee }, { confirmation })
        : refus('Cette objection n’existe pas dans cette entreprise.', confirmation);
    },
  );

  declarer(
    'ordonner_objections',
    {
      description:
        'Donne l’ordre dans lequel l’assistante reçoit les objections : `ordre` liste exactement les identifiants des objections actives, dans l’ordre voulu. Les archivées passent après. Pendant une campagne téléphone en cours de l’entreprise, demande la confirmation de l’opérateur.',
      entree: z.strictObject({ entreprise: champEntreprise, ordre: z.array(z.uuid()).max(200) }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, ordre }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const enCours = await campagnesTelephoneEnCours(e.id);
      let confirmation: 'acceptee' | undefined;
      if (enCours.length) {
        const libelles = ordre.length
          ? await db
              .select({ id: objections.id, libelle: objections.libelle })
              .from(objections)
              .where(and(eq(objections.entrepriseId, e.id), inArray(objections.id, ordre)))
          : [];
        const garde = await confirmer(
          serveur,
          ctx,
          `Réordonner les objections de ${champ(e.nom)} : ${ordre.map((id, i) => `${i + 1}. « ${champ(libelles.find((l) => l.id === id)?.libelle ?? id, 60)} »`).join(' ; ')}. ${avertissementCampagne(enCours)}`,
          ['ordonner_objections', e.id, ordre, enCours],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const r = await entreprise.ordonnerObjections(e.id, ordre);
      return r.ok ? reussite({ entreprise: e.slug, ordre }, { confirmation }) : refus(r.raison, confirmation);
    },
  );

  /* ------------------------------------------------------------------ issues personnalisées */

  declarer(
    'ajouter_issue',
    {
      description: `Ajoute une issue personnalisée à une entreprise, rattachée à une issue système (${ISSUES_SYSTEME.join(', ')}). Le rattachement est figé ensuite.`,
      entree: z.strictObject({ entreprise: champEntreprise, ...issueSchema.shape }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, ...saisie }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return reussite({ issueId: await entreprise.ajouterIssue(e.id, saisie), ...saisie });
    },
  );

  declarer(
    'renommer_issue',
    {
      description: 'Corrige le libellé d’une issue personnalisée ; les bilans passés la suivent. Son issue système de rattachement ne change pas (archiver et recréer pour cela).',
      entree: z.strictObject({ entreprise: champEntreprise, issueId: z.uuid(), libelle: issueSchema.shape.libelle }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, issueId, libelle }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return (await entreprise.renommerIssue(e.id, issueId, libelle)) ? reussite({ issueId, libelle }) : refus('Cette issue n’existe pas dans cette entreprise.');
    },
  );

  declarer(
    'archiver_issue',
    {
      description: 'Archive une issue personnalisée (l’analyse ne la propose plus) ou la désarchive. Jamais supprimée.',
      entree: z.strictObject({ entreprise: champEntreprise, issueId: z.uuid(), archivee: z.boolean() }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, issueId, archivee }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return (await entreprise.basculerArchiveIssue(e.id, issueId, archivee))
        ? reussite({ issueId, archivee })
        : refus('Cette issue n’existe pas dans cette entreprise.');
    },
  );

  /* ------------------------------------------------------------------ scripts */

  declarer(
    'creer_script',
    {
      description:
        'Crée un script d’appel et sa version 1 avec les étapes données (1 à 10, chacune une intention et au plus 4 formulations d’exemple), écrites avec l’opérateur : aucun gabarit n’est posé à sa place.',
      entree: z.strictObject({ entreprise: champEntreprise, nom: nomScriptSchema, etapes: etapesSchema }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, nom, etapes }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return reussite({ ...(await entreprise.creerScript(e.id, nom, etapes, 'mcp')), numero: 1 });
    },
  );

  declarer(
    'creer_version_script',
    {
      description:
        'Crée la version suivante d’un script (une version est figée, jamais écrasée) : 1 à 10 étapes, chacune une intention et au plus 4 formulations d’exemple. Refusée si identique à la dernière version. `connu` : le numéro de la dernière version lue, refus si une autre est arrivée depuis.',
      entree: z.strictObject({ entreprise: champEntreprise, scriptId: z.uuid(), etapes: etapesSchema, connu: z.int().min(1).optional() }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, scriptId, etapes, connu }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const v = await entreprise.creerVersion(e.id, scriptId, etapes, { ...PAR_MCP, connu: connu === undefined ? null : String(connu) });
      return v.ok ? reussite({ versionScriptId: v.id, numero: v.numero }) : refus(v.raison);
    },
  );

  declarer(
    'renommer_script',
    {
      description: 'Renomme un script ; ses versions, ses appels et ses campagnes le suivent.',
      entree: z.strictObject({ entreprise: champEntreprise, scriptId: z.uuid(), nom: nomScriptSchema }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, scriptId, nom }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return (await entreprise.renommerScript(e.id, scriptId, nom)) ? reussite({ scriptId, nom }) : refus('Ce script n’existe pas dans cette entreprise.');
    },
  );

  declarer(
    'archiver_script',
    {
      description:
        'Archive un script (il sort des choix de lancement d’un appel ou d’une campagne) ou le réactive. Rien ne s’arrête : une campagne déjà lancée garde sa version ; l’usage rendu dit ce qui tourne encore.',
      entree: z.strictObject({ entreprise: champEntreprise, scriptId: z.uuid(), archive: z.boolean() }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, scriptId, archive }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      if (!(await entreprise.basculerArchiveScript(e.id, scriptId, archive))) return refus('Ce script n’existe pas dans cette entreprise.');
      return reussite({ scriptId, archive, usage: await usageDuScript(scriptId) });
    },
  );

  /* ------------------------------------------------------------------ prospects */

  declarer(
    'importer_fiches',
    {
      description: `Importe des fiches prospect Markdown dans une entreprise (au plus ${FICHIERS_MAX}, 32 Ko chacune) : en-tête YAML (nom, telephone, societe, role, email) puis le contexte que l’assistante doit connaître. Le nom de fichier identifie le prospect ; réimporter met la fiche à jour. Demander l’import vaut attestation du texte de consentement en vigueur (lire_texte_consentement) : les numéros nouveaux sont enregistrés comme consentants, comme l’import de l’interface case cochée ; un numéro révoqué ne l’est jamais à nouveau, et la fiche d’une personne effacée (effacer_personne) est refusée. Un prospect archivé le reste (liste archives du rapport). Seul un import qui change le numéro ou la fiche (nom, société, rôle, contexte) d’un prospect en file d’une campagne téléphone en cours demande la confirmation de l’opérateur.`,
      entree: z.strictObject({
        entreprise: champEntreprise,
        fiches: z
          .array(z.strictObject({ nomFichier: z.string().min(1).max(120), contenu: z.string() }))
          .min(1, 'Au moins une fiche.')
          .max(FICHIERS_MAX, `${FICHIERS_MAX} fiches au plus par import.`),
      }),
      annotations: ECRITURE,
      // Le contenu des fiches est déjà dans la table prospects : le journal n'en garde que les noms et tailles.
      resumer: ({ entreprise: slug, fiches }) => ({
        entreprise: slug,
        fiches: fiches.map((f) => ({ nomFichier: f.nomFichier, octets: Buffer.byteLength(f.contenu) })),
      }),
    },
    async ({ entreprise: slug, fiches }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      // Un réimport qui change le numéro d'un prospect en file d'une campagne téléphone en cours fait sonner un autre
      // téléphone sans autre question : ce cas seul demande l'accord de l'opérateur (le reste de l'import n'en demande pas).
      const lues = lireFiches(fiches).fiches;
      const actuels = lues.length
        ? await db
            .select({ id: prospects.id, nom: prospects.nom, societe: prospects.societe, role: prospects.role, contexte: prospects.contexte, telephone: prospects.telephone })
            .from(prospects)
            .where(and(eq(prospects.entrepriseId, e.id), inArray(prospects.id, lues.map((f) => f.id))))
        : [];
      // Le numéro, et ce que l'assistante reçoit de la fiche : une campagne en cours s'en servirait sans autre question.
      const changes = lues.flatMap((f) => {
        const avant = actuels.find((p) => p.id === f.id);
        if (!avant) return [];
        const textes = (['nom', 'societe', 'role', 'contexte'] as const).filter((k) => (avant[k] ?? '') !== (f[k] ?? ''));
        return avant.telephone !== f.telephone || textes.length
          ? [{ id: f.id, nom: avant.nom, avant: avant.telephone, apres: f.telephone as string, textes }]
          : [];
      });
      const files = await filesTelephoneEnCours(e.id, changes.map((c) => c.id));
      const enFile = changes.filter((c) => files.has(c.id)).map((c) => ({ ...c, campagnes: files.get(c.id)! }));
      let confirmation: 'acceptee' | undefined;
      if (enFile.length) {
        const garde = await confirmer(
          serveur,
          ctx,
          `Cet import change la fiche ${enFile.length > 1 ? `de ${enFile.length} prospects qui attendent` : 'd’un prospect qui attend'} dans une campagne téléphone en cours (${champ(e.nom)}) : ${enFile
            .map(
              (c) =>
                `${c.avant !== c.apres ? `numéro ${numeroLisible(c.avant)} → ${numeroLisible(c.apres)}, ` : `${numeroLisible(c.avant)}, `}${champ(c.nom, 40)}${
                  c.textes.length ? ` (${c.textes.join(', ')} modifié${c.textes.length > 1 ? 's' : ''})` : ''
                } (campagne ${c.campagnes.join(', ')})`,
            )
            .join(' ; ')}. Un nouveau numéro sera composé à son tour, et l’assistante recevra la fiche modifiée, sans autre question. Nous sommes ${heureDeParis()}.`,
          ['importer_fiches', e.id, enFile.map((c) => [c.id, c.avant, c.apres, c.textes, c.campagnes]), lues.filter((f) => files.has(f.id))],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const rapport = await importerFiches(e.id, fiches, 'mcp');
      if (rapport.etat === 'erreur') return refus(rapport.message, confirmation);
      return reussite(rapport, { confirmation });
    },
  );

  /* ------------------------------------------------------------------ campagnes */

  declarer(
    'nouvelle_campagne',
    {
      description:
        'Prépare une campagne : une liste de prospects d’une entreprise (non archivés), appelés l’un après l’autre avec une même version de script (d’un script non archivé), sur une ligne (bluetooth = le téléphone, simulation, navigateur). Elle est créée prête : rien ne sonne avant son lancement. Une campagne navigateur se prépare ici mais se lance dans l’interface.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        versionScriptId: champVersion,
        ligne: z.enum(['bluetooth', 'simulation', 'navigateur']),
        prospects: z.array(z.string().min(1)).min(1, 'Choisis au moins un prospect.').max(200),
      }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, versionScriptId, ligne, prospects: ids }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const version = await versionDeLEntreprise(e.id, versionScriptId);
      if (!version) return refus('Cette version de script n’appartient pas à cette entreprise.');
      if (version.archive) return refus(SCRIPT_ARCHIVE);
      const connus = await db
        .select({ id: prospects.id, nom: prospects.nom, archiveLe: prospects.archiveLe })
        .from(prospects)
        .where(and(eq(prospects.entrepriseId, e.id), inArray(prospects.id, ids)));
      const inconnus = ids.filter((id) => !connus.some((p) => p.id === id));
      if (inconnus.length) return refus(`Prospects inconnus dans cette entreprise : ${inconnus.join(', ')}.`);
      const archives = connus.filter((p) => p.archiveLe);
      if (archives.length) return refus(`${PROSPECTS_ARCHIVES} : ${archives.map((p) => p.id).join(', ')}. reactiver_prospect d’abord, ou retire-les de la liste.`);
      try {
        return reussite({ campagneId: await enregistrerCampagne(e.id, { versionScriptId, ligne, prospects: ids }), statut: 'prete' });
      } catch (erreur) {
        if (erreur instanceof TransitionInvalide) return refus(erreur.message);
        throw erreur;
      }
    },
  );

  declarer(
    'suspendre_campagne',
    {
      description: 'Met une campagne en pause : l’appel en cours va à son terme, aucun autre ne part. C’est un frein : il ne demande pas de confirmation.',
      entree: z.strictObject({ campagneId: z.uuid() }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ campagneId }) => {
      if (!(await db.$count(campagnes, eq(campagnes.id, campagneId)))) return refus('Campagne inconnue.');
      await suspendreSiEnCours(campagneId);
      const [c] = await db.select({ statut: campagnes.statut }).from(campagnes).where(eq(campagnes.id, campagneId));
      return reussite({ campagneId, statut: c?.statut });
    },
  );
}
