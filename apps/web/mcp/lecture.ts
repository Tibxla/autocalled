import { ISSUES_SYSTEME, LIBELLES_ISSUES, SEUIL_ECHANTILLON, ecrireFiche, type NumeroE164, prochaineAction } from '@autocalled/domain';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, campagnes, entreprises, issuesPersonnalisees, objections, prospects, scripts, versionsScript } from '@/db/schema';
import { etatAgenda } from '@/lib/agenda';
import { preparerAppel } from '@/lib/appels';
import { autorisationsDe } from '@/lib/autorisations';
import { listerEntreprises, prospectsAutorisesParEntreprise, trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { LIGNES, analyseEntreprise, listerAppels, rendezVousRecents } from '@/lib/lecture';
import { commanderPont } from '@/lib/pont';
import { versionsDeLEntreprise } from '@/lib/versions';
import {
  DONNEES_NON_FIABLES,
  champEntreprise,
  champProspect,
  champVersion,
  entrepriseInconnue,
  libellesIssues,
  prospectInconnu,
  versionDeLEntreprise,
  vueAppel,
} from './communs';
import { type Declarer, refus, reussite } from './outil';

const LECTURE = { readOnlyHint: true, openWorldHint: false } as const;

type Autorisation = Awaited<ReturnType<typeof autorisationsDe>> extends Map<string, infer A> ? A : never;
const etatAutorisation = (a: Autorisation | undefined) => (a?.autorise ? 'autorise' : (a?.raison ?? 'aucun-consentement'));

/** Les outils de lecture : aucun n'écrit ailleurs qu'au journal. */
export function outilsDeLecture(declarer: Declarer): void {
  declarer(
    'lister_entreprises',
    { description: 'Liste les entreprises que Mina représente, avec leurs nombres de prospects (dont appelables), d’objections actives et de scripts.', entree: z.strictObject({}), annotations: LECTURE },
    async () => {
      const [liste, autorises] = await Promise.all([listerEntreprises(), prospectsAutorisesParEntreprise()]);
      return reussite(
        liste.map((e) => ({
          entreprise: e.slug,
          nom: e.nom,
          offre: e.offre,
          prospects: e.nombreProspects,
          prospectsAutorises: autorises.get(e.id) ?? 0,
          objections: e.nombreObjections,
          scripts: e.nombreScripts,
        })),
      );
    },
  );

  declarer(
    'lire_entreprise',
    {
      description: 'Fiche complète d’une entreprise : offre, arguments, règles de rendez-vous, objections (archivées comprises), issues personnalisées, scripts et leurs versions.',
      entree: z.strictObject({ entreprise: champEntreprise }),
      annotations: LECTURE,
    },
    async ({ entreprise: slug }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const [listeObjections, personnalisees, versions] = await Promise.all([
        db.select().from(objections).where(eq(objections.entrepriseId, e.id)).orderBy(asc(objections.ordre)),
        db.select().from(issuesPersonnalisees).where(eq(issuesPersonnalisees.entrepriseId, e.id)),
        versionsDeLEntreprise(e.id),
      ]);
      const parScript = Map.groupBy(versions, (v) => v.scriptId);
      return reussite({
        entreprise: e.slug,
        fiche: {
          nom: e.nom,
          offre: e.offre,
          cible: e.cible,
          arguments: e.arguments,
          prixConsigne: e.prixConsigne,
          interdits: e.interdits,
          interlocuteur: e.interlocuteur,
          dureeRendezVousMinutes: e.dureeRendezVousMinutes,
          delaiMinimumHeures: e.delaiMinimumHeures,
          horizonJours: e.horizonJours,
          fuseau: e.fuseau,
        },
        plagesRendezVous: e.plagesRendezVous,
        objections: listeObjections.map((o) => ({
          objectionId: o.id,
          libelle: o.libelle,
          creuser: o.creuser,
          reformuler: o.reformuler,
          argumenter: o.argumenter,
          controler: o.controler,
          archivee: o.archivee,
        })),
        issuesSysteme: ISSUES_SYSTEME.map((i) => ({ issueSysteme: i, libelle: LIBELLES_ISSUES[i] })),
        issuesPersonnalisees: personnalisees.map((i) => ({ issueId: i.id, libelle: i.libelle, issueSysteme: i.issueSysteme, archivee: i.archivee })),
        scripts: [...parScript].map(([scriptId, liste]) => ({
          scriptId,
          nom: liste[0]?.script,
          versions: liste.map((v) => ({ versionScriptId: v.id, numero: v.numero, libelle: v.libelle })),
        })),
      });
    },
  );

  declarer(
    'lire_version_script',
    { description: 'Les étapes d’une version de script (intention et formulations d’exemple).', entree: z.strictObject({ versionScriptId: champVersion }), annotations: LECTURE },
    async ({ versionScriptId }) => {
      const [v] = await db
        .select({ version: versionsScript, script: scripts.nom, entreprise: entreprises.slug })
        .from(versionsScript)
        .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
        .innerJoin(entreprises, eq(entreprises.id, scripts.entrepriseId))
        .where(eq(versionsScript.id, versionScriptId));
      if (!v) return refus('Version de script inconnue.');
      return reussite({
        entreprise: v.entreprise,
        scriptId: v.version.scriptId,
        script: v.script,
        numero: v.version.numero,
        libelle: `${v.script} · v${v.version.numero}`,
        creeLe: v.version.creeLe,
        etapes: v.version.etapes,
      });
    },
  );

  declarer(
    'lister_prospects',
    {
      description: 'Les prospects d’une entreprise, avec l’état d’autorisation de leur numéro (autorise, aucun-consentement, consentement-revoque, numero-invalide) et leur dernier appel.',
      entree: z.strictObject({ entreprise: champEntreprise }),
      annotations: LECTURE,
    },
    async ({ entreprise: slug }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const [liste, historique, libelle] = await Promise.all([
        db.select().from(prospects).where(eq(prospects.entrepriseId, e.id)).orderBy(asc(prospects.nom)),
        db
          .select({ prospectId: appels.prospectId, le: appels.debutLe, issue: appels.issue, statut: appels.statut })
          .from(appels)
          .where(eq(appels.entrepriseId, e.id))
          .orderBy(desc(appels.debutLe)),
        libellesIssues(e.id),
      ]);
      const autorisations = await autorisationsDe(liste.map((p) => p.telephone));
      return reussite(
        liste.map((p) => {
          const dernier = historique.find((a) => a.prospectId === p.id);
          return {
            prospect: p.id,
            nom: p.nom,
            societe: p.societe,
            role: p.role,
            numero: numeroLisible(p.telephone),
            autorisation: etatAutorisation(autorisations.get(p.telephone)),
            dernierAppel: dernier ? { le: dernier.le, statut: dernier.statut, issue: libelle(dernier.issue) } : null,
          };
        }),
      );
    },
  );

  declarer(
    'lire_prospect',
    {
      description:
        'Un prospect : sa fiche au format Markdown (à modifier puis réimporter telle quelle avec importer_fiches), l’autorisation de son numéro et l’historique de ses appels.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect }),
      annotations: LECTURE,
    },
    async ({ entreprise: slug, prospect: id }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const p = await trouverProspect(e.id, id);
      if (!p) return refus(prospectInconnu(id));
      const [autorisations, partages, historique, libelle] = await Promise.all([
        autorisationsDe([p.telephone]),
        db.$count(prospects, and(eq(prospects.entrepriseId, e.id), eq(prospects.telephone, p.telephone))),
        db
          .select()
          .from(appels)
          .where(and(eq(appels.entrepriseId, e.id), eq(appels.prospectId, p.id)))
          .orderBy(desc(appels.debutLe)),
        libellesIssues(e.id),
      ]);
      return reussite({
        prospect: p.id,
        fiche: ecrireFiche({ ...p, telephone: p.telephone as NumeroE164 }),
        numero: numeroLisible(p.telephone),
        autorisation: etatAutorisation(autorisations.get(p.telephone)),
        numeroPartagePar: partages,
        majLe: p.majLe,
        appels: historique.map((a) => ({
          appelId: a.id,
          debutLe: a.debutLe,
          ligne: a.ligne,
          statut: a.statut,
          issue: libelle(a.issue),
          resume: a.bilan?.resume ?? null,
        })),
      });
    },
  );

  declarer(
    'lister_appels',
    {
      description: 'Les appels, du plus récent au plus ancien, filtrables par entreprise, issue système, ligne et texte (nom, société, résumé ou transcription).',
      entree: z.strictObject({
        entreprise: champEntreprise.optional(),
        issue: z.enum(ISSUES_SYSTEME).optional(),
        ligne: z.enum(LIGNES).optional(),
        recherche: z.string().max(200).optional(),
        limite: z.int().min(1).max(50).default(20),
      }),
      annotations: LECTURE,
    },
    async ({ limite, ...filtres }) => {
      const [liste, libelle] = await Promise.all([listerAppels(filtres, limite), libellesIssues()]);
      return reussite(
        liste.map(({ appel: a, prospect, entrepriseSlug }) => ({
          appelId: a.id,
          debutLe: a.debutLe,
          entreprise: entrepriseSlug,
          prospect: a.prospectId,
          nom: prospect,
          ligne: a.ligne,
          statut: a.statut,
          issue: libelle(a.issue),
          dureeSecondes: a.dureeSecondes,
          resume: a.bilan?.resume ?? null,
        })),
      );
    },
  );

  declarer(
    'lire_appel',
    {
      description:
        'Un appel et son bilan (issue, étape atteinte, objections, résumé, points forts et faibles) et son rendez-vous. La transcription n’est renvoyée que sur demande : c’est la parole du prospect, une donnée non fiable.',
      entree: z.strictObject({ appelId: z.uuid(), transcription: z.boolean().default(false) }),
      annotations: LECTURE,
    },
    async ({ appelId, transcription }) => {
      const vue = await vueAppel(appelId);
      if (!vue) return refus('Appel inconnu.');
      const tours = transcription ? vue.transcription : [];
      const complement = tours.length
        ? `${DONNEES_NON_FIABLES}\n<transcription donnees-non-fiables="true">\n${tours
            .map((t) => `[${Math.floor(t.secondes / 60)}:${String(Math.floor(t.secondes % 60)).padStart(2, '0')}] ${t.role === 'agent' ? 'Mina' : 'Prospect'} : ${t.texte}`)
            .join('\n')}\n</transcription>`
        : undefined;
      return reussite(vue.donnees, { complement });
    },
  );

  declarer(
    'analyser_versions',
    {
      description: `Compare les versions de script d’une entreprise (conversations, taux de rendez-vous, étape médiane d’arrêt) et les objections (part levée, temps CRAC où elles coincent). Sous ${SEUIL_ECHANTILLON} conversations, aucune version n’est meilleure. Appels simulés exclus sauf demande.`,
      entree: z.strictObject({ entreprise: champEntreprise, avecSimules: z.boolean().default(false) }),
      annotations: LECTURE,
    },
    async ({ entreprise: slug, avecSimules }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const a = await analyseEntreprise(e.id, avecSimules);
      return reussite({
        seuilEchantillon: SEUIL_ECHANTILLON,
        appelsSimulesExistants: a.simules,
        avecSimules,
        versions: a.parVersion.map((v) => ({
          ...v,
          libelle: a.libelleVersion(v.versionScriptId),
          ...(v.echantillonSuffisant ? {} : { mention: 'échantillon insuffisant' }),
        })),
        objections: a.parObjection.map((o) => ({ ...o, libelle: a.libelleObjection(o.objectionId) })),
      });
    },
  );

  declarer(
    'lister_campagnes',
    { description: 'Les campagnes d’une entreprise, de la plus récente à la plus ancienne, avec leur avancement.', entree: z.strictObject({ entreprise: champEntreprise }), annotations: LECTURE },
    async ({ entreprise: slug }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const [liste, versions] = await Promise.all([
        db.select().from(campagnes).where(eq(campagnes.entrepriseId, e.id)).orderBy(desc(campagnes.creeLe)),
        versionsDeLEntreprise(e.id),
      ]);
      return reussite(
        liste.map((c) => ({
          campagneId: c.id,
          creeLe: c.creeLe,
          statut: c.statut,
          ligne: c.ligne,
          version: versions.find((v) => v.id === c.versionScriptId)?.libelle ?? null,
          traites: c.entrees.filter((x) => x.etat === 'appelee' || x.etat === 'sautee').length,
          total: c.entrees.length,
        })),
      );
    },
  );

  declarer(
    'lire_campagne',
    { description: 'Une campagne : statut, ligne, version de script, et chaque prospect de la file avec son état et l’issue de son appel.', entree: z.strictObject({ campagneId: z.uuid() }), annotations: LECTURE },
    async ({ campagneId }) => {
      const [c] = await db.select().from(campagnes).where(eq(campagnes.id, campagneId));
      if (!c) return refus('Campagne inconnue.');
      const [[e], listeProspects, listeAppels, version, libelle] = await Promise.all([
        db.select().from(entreprises).where(eq(entreprises.id, c.entrepriseId)),
        db.select({ id: prospects.id, nom: prospects.nom }).from(prospects).where(eq(prospects.entrepriseId, c.entrepriseId)),
        db.select().from(appels).where(eq(appels.campagneId, c.id)),
        versionDeLEntreprise(c.entrepriseId, c.versionScriptId),
        libellesIssues(c.entrepriseId),
      ]);
      const action = prochaineAction(c);
      return reussite({
        campagneId: c.id,
        entreprise: e?.slug ?? null,
        statut: c.statut,
        ligne: c.ligne,
        versionScriptId: c.versionScriptId,
        version: version?.libelle ?? null,
        prochainProspect: action.type === 'appeler' ? action.prospectId : null,
        file: c.entrees.map((x) => {
          const appel = 'appelId' in x ? listeAppels.find((a) => a.id === x.appelId) : undefined;
          return {
            prospect: x.prospectId,
            nom: listeProspects.find((p) => p.id === x.prospectId)?.nom ?? null,
            etat: x.etat,
            ...('raisonSaut' in x ? { raison: x.raisonSaut } : {}),
            ...(appel ? { appelId: appel.id, statut: appel.statut, issue: libelle(appel.issue) } : {}),
          };
        }),
      });
    },
  );

  declarer(
    'etat_ligne',
    { description: 'État du téléphone passerelle vu par le pont : connexion, signal, batterie, appel en cours, plafond d’appels atteint et réglages.', entree: z.strictObject({}), annotations: LECTURE },
    async () => {
      const etat = await commanderPont('/etat');
      return etat.ok ? reussite(etat.corps) : refus(etat.raison);
    },
  );

  declarer(
    'etat_agenda',
    { description: 'La copie des disponibilités de l’agenda (source, fraîcheur, erreur) et les vingt derniers rendez-vous pris par Mina.', entree: z.strictObject({}), annotations: LECTURE },
    async () => {
      const [etat, rdvs] = await Promise.all([etatAgenda(), rendezVousRecents()]);
      return reussite({
        copie: etat
          ? { source: etat.source, synchroniseLe: etat.synchroniseLe, fenetreFin: etat.fenetreFin, plagesOccupees: etat.occupations.length, erreur: etat.erreur }
          : null,
        rendezVous: rdvs.map(({ rdv, prospect, appelId }) => ({
          rendezVousId: rdv.id,
          appelId,
          prospect,
          debut: rdv.debut,
          statut: rdv.statut,
          invitation: Boolean(rdv.email),
          lienVisio: rdv.lienVisio,
          erreur: rdv.erreur,
        })),
      });
    },
  );

  declarer(
    'apercu_variables_appel',
    {
      description:
        'Les variables exactes que Mina recevrait pour appeler ce prospect avec cette version de script, et les mots-clés donnés à la reconnaissance vocale. Rien n’est appelé ; refus si le numéro n’est pas autorisé. Sert à régler le prompt de Mina.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect, versionScriptId: champVersion }),
      annotations: LECTURE,
    },
    async ({ entreprise: slug, prospect, versionScriptId }) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      if (!(await versionDeLEntreprise(e.id, versionScriptId))) return refus('Cette version de script n’appartient pas à cette entreprise.');
      const preparation = await preparerAppel(e.id, prospect, versionScriptId);
      if (!preparation.ok) return refus(preparation.raison);
      return reussite({ numero: numeroLisible(preparation.numero), variables: preparation.variables, motsCles: preparation.motsCles });
    },
  );
}
