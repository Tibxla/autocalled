import 'server-only';
import type { EntreeCampagne, IssueSysteme, StatutCampagne } from '@autocalled/domain';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { comptesCampagne, numeroMasque, prochaineEntreeDue, prochaineTentative, quandTentative } from '@/components/format-appel';
import { db } from '@/db';
import { appels, campagnes, entreprises, issuesPersonnalisees, prospects, rendezVous, scripts, versionsScript } from '@/db/schema';
import { numeroLisible } from './format';
import { commanderPont } from './pont';

/**
 * Lectures de l'accueil (régie de la journée). LECTURE SEULE : aucune insertion, mise à jour ni
 * suppression ; le seul appel au pont est GET /etat. « Aujourd'hui » est le jour de Paris : un appel passé
 * à 1 h du matin tombe dans le bon jour, quel que soit le fuseau du serveur.
 */

const DEBUT_JOUR = sql`(date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')`;
const FIN_JOUR = sql`((date_trunc('day', now() at time zone 'Europe/Paris') + interval '1 day') at time zone 'Europe/Paris')`;
const DU_JOUR = sql`(${appels.debutLe} >= ${DEBUT_JOUR} and ${appels.debutLe} < ${FIN_JOUR})`;

export type LigneAppel = 'navigateur' | 'simulation' | 'bluetooth' | 'twilio';
export type StatutAppel = 'en-cours' | 'traitement' | 'termine' | 'echec';

export interface AppelDuJour {
  id: string;
  debutLe: string;
  finLe: string | null;
  dureeSecondes: number | null;
  ligne: LigneAppel;
  /** `entrant` : le prospect a rappelé le téléphone passerelle (facultatif pour les fixtures : absent vaut sortant). */
  sens?: 'sortant' | 'entrant';
  statut: StatutAppel;
  issue: string | null;
  issueSysteme: IssueSysteme | null;
  erreur: string | null;
  /** Une conversation ElevenLabs a été ouverte : il y a quelque chose à rapatrier. */
  conversation: boolean;
  campagneId: string | null;
  resume: string | null;
  etapeAtteinte: number | null;
  rappel: string | null;
  /** Nombre d'étapes de la version de script de l'appel. */
  nombreEtapes: number | null;
  prospectId: string;
  prospect: string;
  societe: string | null;
  entreprise: string;
  entrepriseSlug: string;
  libellePerso: string | null;
  rendezVous: { debut: string; statut: 'a-creer' | 'cree' | 'echec'; erreur: string | null } | null;
}

export interface CampagneJour {
  id: string;
  entreprise: string;
  entrepriseSlug: string;
  /** « Script principal v3 ». */
  version: string;
  ligne: LigneAppel;
  statut: StatutCampagne;
  creeLe: string;
  comptes: ReturnType<typeof comptesCampagne>;
  prochain: { nom: string; societe: string | null } | null;
  /** Les nouvelles tentatives qui attendent leur heure : la plus proche (ISO, et « demain à 14:00 ») et combien ; null s'il n'y en a pas. */
  prochaineTentative: { le: string; quand: string; nombre: number } | null;
  dernierAppel: { id: string; statut: StatutAppel; erreur: string | null; finLe: string | null; conversation: boolean; prospect: string } | null;
}

export type ReglagesLigne = { appelsParHeure: number; appelsParJour: number; pauseEntreAppelsS: number };

export type EtatLigneServeur =
  | { joignable: false }
  | {
      joignable: true;
      connecte: boolean;
      appelEnCours: boolean;
      appelId: string | null;
      /** Un appel entrant est sur la ligne, de la sonnerie au raccroché, décroché ou non (un numéro inconnu sonne sans réponse). */
      entrantEnCours?: boolean;
      /** Le sens de l'appel suivi par la ligne (`appelId`), null sans appel suivi. */
      sens?: 'sortant' | 'entrant' | null;
      /** Phrase du pont quand un appel de plus dépasserait le plafond, sinon null. */
      plafond: string | null;
      /** Heure du prochain appel possible sous plafond (ms depuis l'epoch), quand le pont la donne. */
      plafondJusqua?: number | null;
      reglages: ReglagesLigne | null;
    };

export interface AppelVivant {
  id: string;
  prospect: string;
  societe: string | null;
  entreprise: string;
  version: string | null;
  /** Déjà masqué ici (« 06 •• •• •• 40 ») : le numéro complet ne part jamais vers le navigateur. */
  numeroMasque: string;
  debutLe: string;
  conversation: boolean;
  campagneId: string | null;
  /** Le prospect a rappelé : l'assistante a décroché. */
  entrant: boolean;
  /** Intentions des étapes de la version de l'appel : la bande nomme l'étape signalée en direct. */
  etapes: string[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Les appels du jour de Paris, du plus récent au plus ancien, sans la transcription (lourde). */
export async function appelsDuJour(): Promise<{ appels: AppelDuJour[]; maintenant: string }> {
  const maintenant = new Date().toISOString();
  const lignes = await db
    .select({
      id: appels.id,
      debutLe: appels.debutLe,
      finLe: appels.finLe,
      dureeSecondes: appels.dureeSecondes,
      ligne: appels.ligne,
      sens: appels.sens,
      statut: appels.statut,
      issue: appels.issue,
      issueSysteme: appels.issueSysteme,
      erreur: appels.erreur,
      conversationId: appels.conversationId,
      campagneId: appels.campagneId,
      resume: sql<string | null>`${appels.bilan}->>'resume'`,
      etapeAtteinte: sql<number | null>`(${appels.bilan}->>'etapeAtteinte')::int`,
      rappel: sql<string | null>`${appels.bilan}->>'rappel'`,
      nombreEtapes: sql<number | null>`jsonb_array_length(${versionsScript.etapes})`,
      prospectId: appels.prospectId,
      prospect: prospects.nom,
      societe: prospects.societe,
      entreprise: entreprises.nom,
      entrepriseSlug: entreprises.slug,
      libellePerso: issuesPersonnalisees.libelle,
    })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .leftJoin(versionsScript, eq(versionsScript.id, appels.versionScriptId))
    .leftJoin(issuesPersonnalisees, sql`${appels.issue} = 'perso:' || ${issuesPersonnalisees.id}::text`)
    .where(DU_JOUR)
    .orderBy(desc(appels.debutLe));

  // Rendez-vous à part : un appel peut en porter plusieurs lignes, la jointure doublerait l'appel.
  const ids = lignes.map((l) => l.id);
  const rdv = ids.length
    ? await db
        .select({ appelId: rendezVous.appelId, debut: rendezVous.debut, statut: rendezVous.statut, erreur: rendezVous.erreur })
        .from(rendezVous)
        .where(inArray(rendezVous.appelId, ids))
        .orderBy(desc(rendezVous.creeLe))
    : [];
  const rdvParAppel = new Map<string, (typeof rdv)[number]>();
  for (const r of rdv) if (!rdvParAppel.has(r.appelId)) rdvParAppel.set(r.appelId, r);

  return {
    maintenant,
    appels: lignes.map((l) => {
      const r = rdvParAppel.get(l.id);
      return {
        id: l.id,
        debutLe: l.debutLe.toISOString(),
        finLe: iso(l.finLe),
        dureeSecondes: l.dureeSecondes,
        ligne: l.ligne,
        sens: l.sens,
        statut: l.statut,
        issue: l.issue,
        issueSysteme: l.issueSysteme,
        erreur: l.erreur,
        conversation: Boolean(l.conversationId),
        campagneId: l.campagneId,
        resume: l.resume,
        etapeAtteinte: l.etapeAtteinte,
        rappel: l.rappel,
        nombreEtapes: l.nombreEtapes,
        prospectId: l.prospectId,
        prospect: l.prospect ?? l.prospectId,
        societe: l.societe,
        entreprise: l.entreprise,
        entrepriseSlug: l.entrepriseSlug,
        libellePerso: l.libellePerso,
        rendezVous: r ? { debut: r.debut.toISOString(), statut: r.statut, erreur: r.erreur } : null,
      };
    }),
  };
}

export interface ResultatRecherche {
  id: string;
  /** Le premier tour de la transcription qui contient le terme, découpé autour de lui ; null si seul le nom, la société ou le résumé correspond. */
  extrait: { role: 'agent' | 'prospect'; avant: string; terme: string; apres: string } | null;
}

const AUTOUR = 60;

function extraitDe(texte: string, q: string): { avant: string; terme: string; apres: string } | null {
  const i = texte.toLocaleLowerCase('fr-FR').indexOf(q.toLocaleLowerCase('fr-FR'));
  if (i < 0) return null;
  const debut = Math.max(0, i - AUTOUR);
  const fin = Math.min(texte.length, i + q.length + AUTOUR);
  return {
    avant: `${debut > 0 ? '…' : ''}${texte.slice(debut, i)}`,
    terme: texte.slice(i, i + q.length),
    apres: `${texte.slice(i + q.length, fin)}${fin < texte.length ? '…' : ''}`,
  };
}

/** Les appels du jour qui contiennent `q` (nom, société, entreprise, résumé ou une réplique), avec l'extrait trouvé. */
export async function rechercherDansLaJournee(q: string): Promise<ResultatRecherche[]> {
  const terme = q.trim();
  if (terme.length < 3) return [];
  const motif = `%${terme.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const lignes = await db
    .select({ id: appels.id, transcription: appels.transcription })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .where(
      and(
        DU_JOUR,
        or(
          sql`${prospects.nom} ilike ${motif}`,
          sql`${prospects.societe} ilike ${motif}`,
          sql`${entreprises.nom} ilike ${motif}`,
          sql`${appels.bilan}->>'resume' ilike ${motif}`,
          sql`exists (select 1 from jsonb_array_elements(coalesce(${appels.transcription}, '[]'::jsonb)) as t(tour) where t.tour->>'texte' ilike ${motif})`,
        ),
      ),
    )
    .orderBy(desc(appels.debutLe));
  return lignes.map((l) => {
    for (const tour of l.transcription ?? []) {
      const e = extraitDe(tour.texte, terme);
      if (e) return { id: l.id, extrait: { role: tour.role, ...e } };
    }
    return { id: l.id, extrait: null };
  });
}

/** Le prochain prospect de la file : le premier à appeler dont l'heure est venue (une nouvelle tentative attend la sienne). */
function prochainDu(entrees: readonly EntreeCampagne[], maintenant: Date): string | undefined {
  return prochaineEntreeDue(entrees, maintenant)?.prospectId;
}

function tentativeAVenir(entrees: readonly EntreeCampagne[], maintenant: Date): CampagneJour['prochaineTentative'] {
  const t = prochaineTentative(entrees, maintenant);
  return t ? { ...t, quand: quandTentative(t.le, maintenant) } : null;
}

/** Campagnes prêtes, en cours ou suspendues, et celles qui ont appelé aujourd'hui ; la plus récente d'abord. */
export async function campagnesDuJour(): Promise<CampagneJour[]> {
  const maintenant = new Date();
  const lignes = await db
    .select({
      id: campagnes.id,
      entrepriseId: campagnes.entrepriseId,
      entreprise: entreprises.nom,
      entrepriseSlug: entreprises.slug,
      script: scripts.nom,
      numero: versionsScript.numero,
      ligne: campagnes.ligne,
      statut: campagnes.statut,
      entrees: campagnes.entrees,
      creeLe: campagnes.creeLe,
    })
    .from(campagnes)
    .innerJoin(entreprises, eq(entreprises.id, campagnes.entrepriseId))
    .innerJoin(versionsScript, eq(versionsScript.id, campagnes.versionScriptId))
    .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(
      or(
        inArray(campagnes.statut, ['prete', 'en-cours', 'en-pause']),
        sql`exists (select 1 from ${appels} where ${appels.campagneId} = ${campagnes.id} and ${DU_JOUR})`,
      ),
    )
    .orderBy(desc(campagnes.creeLe))
    .limit(20);
  if (lignes.length === 0) return [];

  const suivants = lignes
    .map((l) => ({ entrepriseId: l.entrepriseId, prospectId: prochainDu(l.entrees as EntreeCampagne[], maintenant) }))
    .filter((s): s is { entrepriseId: string; prospectId: string } => Boolean(s.prospectId));
  const [fiches, derniers] = await Promise.all([
    suivants.length
      ? db
          .select({ entrepriseId: prospects.entrepriseId, id: prospects.id, nom: prospects.nom, societe: prospects.societe })
          .from(prospects)
          .where(or(...suivants.map((s) => and(eq(prospects.entrepriseId, s.entrepriseId), eq(prospects.id, s.prospectId)))))
      : [],
    db
      .selectDistinctOn([appels.campagneId], {
        campagneId: appels.campagneId,
        id: appels.id,
        statut: appels.statut,
        erreur: appels.erreur,
        finLe: appels.finLe,
        conversationId: appels.conversationId,
        prospectId: appels.prospectId,
        prospect: prospects.nom,
      })
      .from(appels)
      .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
      .where(
        inArray(
          appels.campagneId,
          lignes.map((l) => l.id),
        ),
      )
      .orderBy(appels.campagneId, desc(appels.debutLe)),
  ]);

  return lignes.map((l) => {
    const entrees = l.entrees as EntreeCampagne[];
    const idSuivant = prochainDu(entrees, maintenant);
    const fiche = idSuivant ? fiches.find((f) => f.entrepriseId === l.entrepriseId && f.id === idSuivant) : undefined;
    const dernier = derniers.find((d) => d.campagneId === l.id);
    return {
      id: l.id,
      entreprise: l.entreprise,
      entrepriseSlug: l.entrepriseSlug,
      version: `${l.script} v${l.numero}`,
      ligne: l.ligne,
      statut: l.statut,
      creeLe: l.creeLe.toISOString(),
      comptes: comptesCampagne(entrees),
      prochain: idSuivant ? { nom: fiche?.nom ?? idSuivant, societe: fiche?.societe ?? null } : null,
      prochaineTentative: tentativeAVenir(entrees, maintenant),
      dernierAppel: dernier
        ? {
            id: dernier.id,
            statut: dernier.statut,
            erreur: dernier.erreur,
            finLe: iso(dernier.finLe),
            conversation: Boolean(dernier.conversationId),
            prospect: dernier.prospect ?? dernier.prospectId,
          }
        : null,
    };
  });
}

/** État de la ligne téléphone vu du serveur (GET /etat du pont ; au plus 15 s d'attente). */
export async function etatLigneServeur(): Promise<EtatLigneServeur> {
  const r = await commanderPont('/etat');
  if (!r.ok) return { joignable: false };
  const c = r.corps as {
    connecte?: unknown;
    appelEnCours?: unknown;
    appelId?: unknown;
    entrantEnCours?: unknown;
    sens?: unknown;
    plafond?: unknown;
    plafondJusqua?: unknown;
    reglages?: unknown;
  };
  const reglages = c.reglages as Partial<ReglagesLigne> | undefined;
  return {
    joignable: true,
    connecte: Boolean(c.connecte),
    appelEnCours: Boolean(c.appelEnCours),
    appelId: typeof c.appelId === 'string' ? c.appelId : null,
    entrantEnCours: Boolean(c.entrantEnCours),
    sens: c.sens === 'entrant' || c.sens === 'sortant' ? c.sens : null,
    plafond: typeof c.plafond === 'string' ? c.plafond : null,
    plafondJusqua: typeof c.plafond === 'string' && typeof c.plafondJusqua === 'number' ? c.plafondJusqua : null,
    reglages:
      reglages && typeof reglages.appelsParHeure === 'number' && typeof reglages.appelsParJour === 'number' && typeof reglages.pauseEntreAppelsS === 'number'
        ? { appelsParHeure: reglages.appelsParHeure, appelsParJour: reglages.appelsParJour, pauseEntreAppelsS: reglages.pauseEntreAppelsS }
        : null,
  };
}

/** L'identité de l'appel que le pont dit en cours ; null s'il est inconnu de la base. */
export async function appelVivant(appelId: string): Promise<AppelVivant | null> {
  if (!/^[0-9a-f-]{36}$/i.test(appelId)) return null;
  const [l] = await db
    .select({
      id: appels.id,
      numero: appels.numero,
      sens: appels.sens,
      debutLe: appels.debutLe,
      conversationId: appels.conversationId,
      campagneId: appels.campagneId,
      prospectId: appels.prospectId,
      prospect: prospects.nom,
      societe: prospects.societe,
      entreprise: entreprises.nom,
      script: scripts.nom,
      numeroVersion: versionsScript.numero,
      etapes: versionsScript.etapes,
    })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .leftJoin(versionsScript, eq(versionsScript.id, appels.versionScriptId))
    .leftJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(eq(appels.id, appelId));
  if (!l) return null;
  return {
    id: l.id,
    prospect: l.prospect ?? l.prospectId,
    societe: l.societe,
    entreprise: l.entreprise,
    version: l.script && l.numeroVersion != null ? `${l.script} v${l.numeroVersion}` : null,
    numeroMasque: numeroMasque(numeroLisible(l.numero)),
    debutLe: l.debutLe.toISOString(),
    conversation: Boolean(l.conversationId),
    campagneId: l.campagneId,
    entrant: l.sens === 'entrant',
    etapes: (l.etapes ?? []).map((e) => e.intention),
  };
}

/**
 * Appels téléphone des dernières 24 h et de la dernière heure, d'après la base (le pont ne publie pas ses compteurs) :
 * les compositions seulement, comme le plafond du pont. Un appel entrant n'y compte pas.
 */
export async function appelsTelephoneRecents(): Promise<{ derniereHeure: number; dernieres24h: number }> {
  const [r] = await db
    .select({
      derniereHeure: sql<number>`count(*) filter (where ${appels.debutLe} > now() - interval '1 hour')::int`,
      dernieres24h: sql<number>`count(*)::int`,
    })
    .from(appels)
    .where(and(eq(appels.ligne, 'bluetooth'), eq(appels.sens, 'sortant'), sql`${appels.debutLe} > now() - interval '24 hours'`));
  return { derniereHeure: r?.derniereHeure ?? 0, dernieres24h: r?.dernieres24h ?? 0 };
}

/** De quoi savoir si l'application sert pour la première fois (aucune entreprise, aucun script, aucun prospect). */
export async function premiereUtilisation(): Promise<{ entreprises: number; scripts: number; prospects: number }> {
  const [[e], [s], [p]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(entreprises),
    db.select({ n: sql<number>`count(*)::int` }).from(scripts),
    db.select({ n: sql<number>`count(*)::int` }).from(prospects),
  ]);
  return { entreprises: e?.n ?? 0, scripts: s?.n ?? 0, prospects: p?.n ?? 0 };
}
