import { ISSUES_SYSTEME, TransitionInvalide } from '@autocalled/domain';
import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { campagnes, objections, prospects } from '@/db/schema';
import { enregistrerCampagne, suspendreSiEnCours } from '@/lib/campagnes';
import { trouverEntreprise } from '@/lib/donnees';
import * as entreprise from '@/lib/entreprises';
import { FICHIERS_MAX, importerFiches } from '@/lib/prospects';
import { etapesSchema, ficheSchema, issueSchema, nomEntrepriseSchema, nomScriptSchema, objectionSchema, plagesSchema } from '@/lib/schemas';
import { usageDuScript } from '@/lib/versions';
import { champEntreprise, champVersion, entrepriseInconnue, SCRIPT_ARCHIVE, versionDeLEntreprise } from './communs';
import { confirmer, refusDeConfirmation } from './confirmation';
import { type Declarer, refus, reussite } from './outil';

/**
 * La configuration d'une entreprise (fiche, objections, issues, scripts), l'import des fiches prospect et la
 * préparation des campagnes. Toute écriture passe l'origine `mcp` en clair. Aucune ne fait sonner un téléphone ni
 * n'écrit à un prospect ; seule la suppression d'une entreprise vide, irréversible, demande une confirmation.
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
        'Modifie la fiche d’une entreprise : seuls les champs donnés changent, le reste est gardé. `plages` remplace toutes les plages de rendez-vous (jour 1 = lundi … 7 = dimanche, heures HH:MM). Changer `nom` ne change pas l’identifiant (slug). `connu` : le `modifieLe` de lire_entreprise, refus si la fiche a changé depuis.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        champs: ficheSchema.partial().strict().default({}),
        plages: plagesSchema.optional(),
        connu: connuHorodatage,
      }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, champs, plages, connu }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      // Le patch est fusionné avec la fiche actuelle, puis validé par le même schéma que le formulaire.
      const fiche = ficheSchema.safeParse({ ...e, ...champs });
      if (!fiche.success) return refus(premiereErreur(fiche.error));
      const lesPlages = plagesSchema.safeParse(plages ?? e.plagesRendezVous);
      if (!lesPlages.success) return refus(premiereErreur(lesPlages.error));
      // Sans `connu`, la fiche lue au début de l'outil : rien n'est écrasé entre la lecture, la fusion et l'écriture.
      const r = await entreprise.enregistrerFiche(e.id, fiche.data, lesPlages.data, { ...PAR_MCP, connu: connu ?? e.modifieLe.toISOString() });
      return r.ok ? reussite({ entreprise: e.slug, modifieLe: r.modifieLe, fiche: fiche.data, plagesRendezVous: lesPlages.data }) : refus(r.raison);
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
        `Supprimer définitivement l’entreprise ${e.nom} (${e.slug}) et sa fiche${parties.length ? `, avec ${parties.join(', ')}` : ''}. Rien ne se récupère.`,
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
        'Ajoute une objection à une entreprise, avec sa réponse CRAC (creuser, reformuler, argumenter, contrôler), ou modifie celle dont on donne objectionId (les champs absents sont gardés). `connu` : son `modifieLe` lu dans lire_entreprise, refus si elle a changé depuis. Un libellé vient de l’opérateur, jamais recopié d’une transcription sans sa demande.',
      entree: z.strictObject({
        entreprise: champEntreprise,
        objectionId: z.uuid().optional(),
        ...objectionSchema.partial().shape,
        connu: connuHorodatage,
      }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, objectionId, connu, ...champs }) => {
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
      const r = await entreprise.enregistrerObjection(e.id, objectionId ?? null, saisie.data, {
        ...PAR_MCP,
        connu: connu ?? actuelle.modifieLe?.toISOString() ?? null,
      });
      return r.ok ? reussite({ objectionId: r.id, ...saisie.data }) : refus(r.raison);
    },
  );

  declarer(
    'archiver_objection',
    {
      description: 'Archive une objection (l’assistante ne la reçoit plus) ou la désarchive. Une objection n’est jamais supprimée : les bilans passés y font référence.',
      entree: z.strictObject({ entreprise: champEntreprise, objectionId: z.uuid(), archivee: z.boolean() }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, objectionId, archivee }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return (await entreprise.basculerArchiveObjection(e.id, objectionId, archivee, 'mcp'))
        ? reussite({ objectionId, archivee })
        : refus('Cette objection n’existe pas dans cette entreprise.');
    },
  );

  declarer(
    'ordonner_objections',
    {
      description:
        'Donne l’ordre dans lequel l’assistante reçoit les objections : `ordre` liste exactement les identifiants des objections actives, dans l’ordre voulu. Les archivées passent après.',
      entree: z.strictObject({ entreprise: champEntreprise, ordre: z.array(z.uuid()).max(200) }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, ordre }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const r = await entreprise.ordonnerObjections(e.id, ordre);
      return r.ok ? reussite({ entreprise: e.slug, ordre }) : refus(r.raison);
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
      description: `Importe des fiches prospect Markdown dans une entreprise (au plus ${FICHIERS_MAX}, 32 Ko chacune) : en-tête YAML (nom, telephone, societe, role, email) puis le contexte que l’assistante doit connaître. Le nom de fichier identifie le prospect ; réimporter met la fiche à jour. Demander l’import vaut attestation du texte de consentement en vigueur (lire_texte_consentement) : les numéros nouveaux sont enregistrés comme consentants, comme l’import de l’interface case cochée ; un numéro révoqué ne l’est jamais à nouveau.`,
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
    async ({ entreprise: slug, fiches }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const rapport = await importerFiches(e.id, fiches, 'mcp');
      if (rapport.etat === 'erreur') return refus(rapport.message);
      return reussite(rapport);
    },
  );

  /* ------------------------------------------------------------------ campagnes */

  declarer(
    'nouvelle_campagne',
    {
      description:
        'Prépare une campagne : une liste de prospects d’une entreprise, appelés l’un après l’autre avec une même version de script (d’un script non archivé), sur une ligne (bluetooth = le téléphone, simulation, navigateur). Elle est créée prête : rien ne sonne avant son lancement. Une campagne navigateur se prépare ici mais se lance dans l’interface.',
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
        .select({ id: prospects.id })
        .from(prospects)
        .where(and(eq(prospects.entrepriseId, e.id), inArray(prospects.id, ids)));
      const inconnus = ids.filter((id) => !connus.some((p) => p.id === id));
      if (inconnus.length) return refus(`Prospects inconnus dans cette entreprise : ${inconnus.join(', ')}.`);
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
