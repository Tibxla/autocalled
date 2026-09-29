import { ISSUES_SYSTEME, TransitionInvalide } from '@autocalled/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { campagnes, objections, prospects } from '@/db/schema';
import { enregistrerCampagne, suspendreSiEnCours } from '@/lib/campagnes';
import { trouverEntreprise } from '@/lib/donnees';
import * as entreprise from '@/lib/entreprises';
import { FICHIERS_MAX, importerFiches } from '@/lib/prospects';
import { etapesSchema, ficheSchema, issueSchema, nomEntrepriseSchema, nomScriptSchema, objectionSchema, plagesSchema } from '@/lib/schemas';
import { champEntreprise, champVersion, entrepriseInconnue, versionDeLEntreprise } from './communs';
import { type Declarer, refus, reussite } from './outil';

/** Écritures réversibles ou additives : aucune ne fait sonner un téléphone ni n'écrit à un prospect. */
const ECRITURE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** La première erreur d'un schéma, dans les mots de l'interface. */
const premiereErreur = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join('.')} : ` : ''}${i.message}` : 'Saisie invalide.';
};

export function outilsDeConfiguration(declarer: Declarer): void {
  declarer(
    'creer_entreprise',
    { description: 'Crée une entreprise que Mina pourra représenter ; renvoie son identifiant (slug).', entree: z.strictObject({ nom: nomEntrepriseSchema }), annotations: ECRITURE },
    async ({ nom }) => {
      const creee = await entreprise.creerEntreprise(nom);
      return creee.ok ? reussite({ entreprise: creee.slug }) : refus(creee.raison);
    },
  );

  declarer(
    'modifier_fiche_entreprise',
    {
      description:
        'Modifie la fiche d’une entreprise : seuls les champs donnés changent, le reste est gardé. `plages` remplace toutes les plages de rendez-vous (jour 1 = lundi … 7 = dimanche, heures HH:MM).',
      entree: z.strictObject({
        entreprise: champEntreprise,
        champs: ficheSchema.partial().strict().default({}),
        plages: plagesSchema.optional(),
      }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, champs, plages }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      // Le patch est fusionné avec la fiche actuelle, puis validé par le même schéma que le formulaire.
      const fiche = ficheSchema.safeParse({ ...e, ...champs });
      if (!fiche.success) return refus(premiereErreur(fiche.error));
      const lesPlages = plagesSchema.safeParse(plages ?? e.plagesRendezVous);
      if (!lesPlages.success) return refus(premiereErreur(lesPlages.error));
      await entreprise.enregistrerFiche(e.id, fiche.data, lesPlages.data);
      return reussite({ entreprise: e.slug, fiche: fiche.data, plagesRendezVous: lesPlages.data });
    },
  );

  declarer(
    'enregistrer_objection',
    {
      description:
        'Ajoute une objection à une entreprise, avec sa réponse CRAC (creuser, reformuler, argumenter, contrôler), ou modifie celle dont on donne objectionId (les champs absents sont gardés).',
      entree: z.strictObject({
        entreprise: champEntreprise,
        objectionId: z.uuid().optional(),
        ...objectionSchema.partial().shape,
      }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, objectionId, ...champs }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      let actuelle = {};
      if (objectionId) {
        const [o] = await db.select().from(objections).where(and(eq(objections.id, objectionId), eq(objections.entrepriseId, e.id)));
        if (!o) return refus('Cette objection n’existe pas dans cette entreprise.');
        actuelle = o;
      }
      const saisie = objectionSchema.safeParse({ creuser: '', reformuler: '', argumenter: '', controler: '', ...actuelle, ...champs });
      if (!saisie.success) return refus(premiereErreur(saisie.error));
      const r = await entreprise.enregistrerObjection(e.id, objectionId ?? null, saisie.data);
      return r.ok ? reussite({ objectionId: r.id, ...saisie.data }) : refus(r.raison);
    },
  );

  declarer(
    'archiver_objection',
    {
      description: 'Archive une objection (Mina ne la reçoit plus) ou la désarchive. Une objection n’est jamais supprimée : les bilans passés y font référence.',
      entree: z.strictObject({ entreprise: champEntreprise, objectionId: z.uuid(), archivee: z.boolean() }),
      annotations: { ...ECRITURE, idempotentHint: true },
    },
    async ({ entreprise: slug, objectionId, archivee }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return (await entreprise.basculerArchiveObjection(e.id, objectionId, archivee))
        ? reussite({ objectionId, archivee })
        : refus('Cette objection n’existe pas dans cette entreprise.');
    },
  );

  declarer(
    'ajouter_issue',
    {
      description: `Ajoute une issue personnalisée à une entreprise, rattachée à une issue système (${ISSUES_SYSTEME.join(', ')}).`,
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

  declarer(
    'creer_script',
    { description: 'Crée un script d’appel ; sa version 1 reçoit les quatre étapes de départ (accroche, qualification, pitch, rendez-vous).', entree: z.strictObject({ entreprise: champEntreprise, nom: nomScriptSchema }), annotations: ECRITURE },
    async ({ entreprise: slug, nom }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      return reussite(await entreprise.creerScript(e.id, nom));
    },
  );

  declarer(
    'creer_version_script',
    {
      description:
        'Crée la version suivante d’un script (une version est figée, jamais écrasée) : 1 à 10 étapes, chacune une intention et au plus 4 formulations d’exemple. Refusée si identique à la dernière version.',
      entree: z.strictObject({ entreprise: champEntreprise, scriptId: z.uuid(), etapes: etapesSchema }),
      annotations: ECRITURE,
    },
    async ({ entreprise: slug, scriptId, etapes }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const v = await entreprise.creerVersion(e.id, scriptId, etapes);
      return v.ok ? reussite({ versionScriptId: v.id, numero: v.numero }) : refus(v.raison);
    },
  );

  declarer(
    'importer_fiches',
    {
      description: `Importe des fiches prospect Markdown dans une entreprise (au plus ${FICHIERS_MAX}, 32 Ko chacune) : en-tête YAML (nom, telephone, societe, role, email) puis le contexte que Mina doit connaître. Le nom de fichier identifie le prospect ; réimporter met la fiche à jour. Les numéros nouveaux sont enregistrés comme consentants, comme l’import de l’interface case cochée ; un numéro révoqué ne l’est jamais à nouveau.`,
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
      const rapport = await importerFiches(e.id, fiches);
      if (rapport.etat === 'erreur') return refus(rapport.message);
      return reussite(rapport);
    },
  );

  declarer(
    'nouvelle_campagne',
    {
      description:
        'Prépare une campagne : une liste de prospects d’une entreprise, appelés l’un après l’autre avec une même version de script, sur une ligne (bluetooth = le téléphone, simulation, navigateur). Elle est créée prête : rien ne sonne avant son lancement.',
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
      if (!(await versionDeLEntreprise(e.id, versionScriptId))) return refus('Cette version de script n’appartient pas à cette entreprise.');
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
