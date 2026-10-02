import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ISSUES_SYSTEME,
  instantDuRappel,
  LIBELLES_ISSUES,
  type NumeroAppelable,
  SENS_ISSUES,
  type VariablesDeLAppel,
} from '@autocalled/domain';
import { creneauParle } from '@autocalled/agenda';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees, objections, prospects, rendezVous, scripts, versionsScript } from '@/db/schema';
import { variablesPour } from './apercu';
import { VERSION_ANALYSEUR, analyser } from './analyseur';
import { lireAssistante } from './assistante';
import { appelabiliteDe } from './appelables';
import { rafraichirSiAncien } from './agenda';
import { classerDansSaCampagne, retirerTentativesApresRappel } from './campagnes';
import { audioConversation, lireConversation, simulerConversation } from './elevenlabs';
import { commanderPont, refusDuPont } from './pont';

/** Dossier des enregistrements, hors dépôt (sauvegardé par Restic avec le reste du serveur). */
export function dossierDonnees(): string {
  return process.env.DOSSIER_DONNEES ?? join(process.cwd(), '..', '..', 'data');
}

export type PreparationAppel =
  | {
      ok: true;
      numero: NumeroAppelable;
      variables: VariablesDeLAppel;
      entrepriseId: string;
      motsCles: string[];
      /** Ce que l'assistante dit si le prospect se tait au décroché, déjà composé. */
      premierMessage: string;
      /** Ce qu'elle dit juste après un « bonjour » court au décroché (ligne téléphone), sinon null : le modèle ouvre. */
      ouverture: string | null;
      /** Le nom sous lequel l'assistante se présente : figé sur l'appel enregistré. */
      assistanteNom: string;
    }
  | { ok: false; raison: string };

export const PROSPECT_ARCHIVE = 'Ce prospect est archivé : il n’est plus appelé. Réactive-le pour l’appeler.';

/**
 * Tout ce qu'il faut pour appeler un prospect, vérifié au dernier moment : le numéro doit être
 * appelable à l'instant même (valide, hors de la liste d'opposition), quelle que soit la ligne.
 */
export async function preparerAppel(entrepriseId: string, prospectId: string, versionScriptId: string): Promise<PreparationAppel> {
  const [entreprise] = await db.select().from(entreprises).where(eq(entreprises.id, entrepriseId));
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  // La version doit être celle d'un script de cette entreprise.
  const [ligneVersion] = await db
    .select({ version: versionsScript })
    .from(versionsScript)
    .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(and(eq(versionsScript.id, versionScriptId), eq(scripts.entrepriseId, entrepriseId)));
  const version = ligneVersion?.version;
  if (!entreprise || !prospect || !version) return { ok: false, raison: 'Prospect ou version de script introuvable.' };
  // Un prospect archivé n'est plus appelé (ADR 0013) : ni appel isolé, ni campagne.
  if (prospect.archiveLe) return { ok: false, raison: PROSPECT_ARCHIVE };

  const verification = (await appelabiliteDe([prospect.telephone])).get(prospect.telephone);
  if (!verification?.appelable) {
    return {
      ok: false,
      raison:
        verification?.raison === 'numero-efface'
          ? 'Ce numéro appartient à une personne effacée à sa demande : il ne sera plus jamais composé.'
          : verification?.raison === 'opposition-illisible'
            ? 'La liste d’opposition ne se lit plus (SEL_OPPOSITION manque ou a changé) : aucun numéro n’est composé.'
            : 'Le numéro de ce prospect n’est pas un numéro de téléphone valide : corrige sa fiche.',
    };
  }

  const { variables, motsCles, premierMessage, ouverture } = await variablesPour(entreprise, prospect, version.etapes, new Date());
  return {
    ok: true,
    numero: verification.numero,
    variables,
    entrepriseId,
    motsCles,
    premierMessage,
    ouverture,
    assistanteNom: variables.assistante_nom,
  };
}

/**
 * Ligne téléphone (ADR 0007) : vérifie le numéro et le plafond, enregistre l'appel, puis demande au pont
 * de composer. La suite arrive par les routes /api/pont/… (conversation, outils d'agenda, fin).
 */
export async function appelerParTelephone(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<{ ok: true; appelId: string } | { ok: false; raison: string }> {
  const preparation = await preparerAppel(entrepriseId, prospectId, versionScriptId);
  if (!preparation.ok) return preparation;
  // Un appel de campagne attend la fin du précédent dans l'enchaînement ; un appel isolé refuse une ligne occupée.
  const refus = await refusDuPont({ ligneLibre: campagneId === null });
  if (refus) return { ok: false, raison: refus };

  await rafraichirSiAncien();
  const [appel] = await db
    .insert(appels)
    .values({
      entrepriseId,
      prospectId,
      versionScriptId,
      campagneId,
      ligne: 'bluetooth',
      numero: preparation.numero,
      assistanteNom: preparation.assistanteNom,
    })
    .returning({ id: appels.id });
  if (!appel) return { ok: false, raison: 'Impossible d’enregistrer l’appel.' };

  const reponse = await commanderPont('/appels', {
    appelId: appel.id,
    numero: preparation.numero,
    variables: preparation.variables,
    motsCles: preparation.motsCles,
    premierMessage: preparation.premierMessage,
    ...(preparation.ouverture ? { ouverture: preparation.ouverture } : {}),
  });
  if (!reponse.ok) {
    await db.update(appels).set({ statut: 'echec', erreur: reponse.raison, finLe: new Date() }).where(eq(appels.id, appel.id));
    return { ok: false, raison: reponse.raison };
  }
  return { ok: true, appelId: appel.id };
}

/** Enregistre un appel simulé après le même contrôle du numéro ; la conversation se joue avec `simulerAppel`. */
export async function enregistrerAppelSimule(
  entrepriseId: string,
  prospectId: string,
  versionScriptId: string,
  campagneId: string | null = null,
): Promise<{ ok: true; appelId: string; variables: VariablesDeLAppel } | { ok: false; raison: string }> {
  const preparation = await preparerAppel(entrepriseId, prospectId, versionScriptId);
  if (!preparation.ok) return preparation;
  const [appel] = await db
    .insert(appels)
    .values({
      entrepriseId,
      prospectId,
      versionScriptId,
      campagneId,
      ligne: 'simulation',
      numero: preparation.numero,
      assistanteNom: preparation.assistanteNom,
    })
    .returning({ id: appels.id });
  if (!appel) return { ok: false, raison: 'Impossible d’enregistrer l’appel.' };
  return { ok: true, appelId: appel.id, variables: preparation.variables };
}

export const APPEL_PURGE = 'Cet appel a passé la durée de conservation : son enregistrement, sa transcription et le détail de son bilan sont effacés, il ne se réanalyse plus.';

/** Au-delà, une analyse encore « en traitement » est tenue pour bloquée : on peut la relancer. */
export const DUREE_MAX_ANALYSE_S = 5 * 60;

/**
 * Prépare une relance du bilan demandée par l'opérateur : refuse ce qui ne peut pas être relancé, puis passe
 * l'appel en `traitement` tout de suite, pour que la page relue montre l'analyse en cours. Le travail lui-même
 * (`reanalyser`) se fait ensuite, en tâche de fond.
 */
export async function preparerReanalyse(appelId: string, maintenant = new Date()): Promise<{ ok: true } | { ok: false; raison: string }> {
  const [a] = await db
    .select({
      statut: appels.statut,
      ligne: appels.ligne,
      conversationId: appels.conversationId,
      transcription: appels.transcription,
      debutLe: appels.debutLe,
      finLe: appels.finLe,
      traitementLe: appels.traitementLe,
      purgeLe: appels.purgeLe,
    })
    .from(appels)
    .where(eq(appels.id, appelId));
  if (!a) return { ok: false, raison: 'Cet appel n’existe plus.' };
  // Rapatrier de nouveau la conversation rendrait ce que la durée de conservation a effacé (ADR 0014).
  if (a.purgeLe) return { ok: false, raison: APPEL_PURGE };
  if (!a.transcription && !a.conversationId) return { ok: false, raison: 'Cet appel n’a ni transcription ni conversation à rapatrier : rien à analyser.' };
  if (a.statut === 'en-cours' && a.ligne === 'bluetooth') return { ok: false, raison: 'L’appel est en cours : son bilan sera calculé à la fin.' };
  const depuis = a.traitementLe ?? a.finLe ?? a.debutLe;
  if (a.statut === 'traitement' && maintenant.getTime() - depuis.getTime() < DUREE_MAX_ANALYSE_S * 1000) {
    return { ok: false, raison: 'Le bilan de cet appel est déjà en cours de calcul.' };
  }
  // Pas sur un appel purgé entre la lecture et ici.
  const [pret] = await db
    .update(appels)
    .set({ statut: 'traitement', traitementLe: maintenant, erreur: null })
    .where(and(eq(appels.id, appelId), isNull(appels.purgeLe)))
    .returning({ id: appels.id });
  if (!pret) return { ok: false, raison: APPEL_PURGE };
  return { ok: true };
}

/** Recalcule le bilan : analyse seule si la transcription est là, sinon rapatriement complet. */
export async function reanalyser(appelId: string): Promise<void> {
  const [appel] = await db.select({ transcription: appels.transcription }).from(appels).where(eq(appels.id, appelId));
  await (appel?.transcription ? analyserAppel(appelId) : traiterAppel(appelId));
}

/**
 * Rapatrie la conversation terminée (transcription, durée, audio) puis lance l'analyse. Quel que soit le chemin
 * (bilan écrit ou échec), l'appel est ensuite classé dans sa campagne.
 */
export async function traiterAppel(appelId: string): Promise<void> {
  await rapatrier(appelId);
  await apresBilan(appelId);
}

/**
 * Ce que le bilan (ou son échec) change aux files : l'appel sortant est classé dans sa campagne ; un prospect qui a
 * rappelé et parlé à l'assistante n'a plus de nouvelle tentative prévue. Sans effet sur ce qui l'a déjà été.
 */
async function apresBilan(appelId: string): Promise<void> {
  await classerDansSaCampagne(appelId);
  await retirerTentativesApresRappel(appelId);
}

async function rapatrier(appelId: string): Promise<void> {
  const [appel] = await db.select().from(appels).where(eq(appels.id, appelId));
  if (!appel || appel.purgeLe) return;
  if (!appel.conversationId) {
    await db
      .update(appels)
      .set({
        statut: 'echec',
        erreur: 'Aucune conversation n’est rattachée à cet appel : rien à rapatrier, donc pas de bilan.',
        finLe: appel.finLe ?? new Date(),
      })
      .where(eq(appels.id, appelId));
    return;
  }
  await db.update(appels).set({ statut: 'traitement', traitementLe: new Date(), finLe: appel.finLe ?? new Date() }).where(eq(appels.id, appelId));

  try {
    let conversation = await lireConversation(appel.conversationId);
    for (let i = 0; i < 60 && (conversation.statut === 'processing' || conversation.statut === 'in-progress' || conversation.statut === 'initiated'); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      conversation = await lireConversation(appel.conversationId);
    }
    if (conversation.statut === 'failed') throw new Error('ElevenLabs indique une conversation en échec.');

    let audio: string | null = null;
    if (conversation.audio) {
      const dossier = join(dossierDonnees(), 'enregistrements');
      // La voix du prospect : au seul compte du service.
      await mkdir(dossier, { recursive: true, mode: 0o700 });
      audio = `enregistrements/${appelId}.mp3`;
      await writeFile(join(dossierDonnees(), audio), Buffer.from(await audioConversation(appel.conversationId)), { mode: 0o600 });
    }

    await db
      .update(appels)
      .set({
        transcription: conversation.transcription,
        dureeSecondes: conversation.dureeSecondes,
        versionAgent: conversation.versionAgent,
        audio,
      })
      // Jamais sur un appel purgé entre-temps (ADR 0014).
      .where(and(eq(appels.id, appelId), isNull(appels.purgeLe)));
  } catch (erreur) {
    await db.update(appels).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(appels.id, appelId));
    return;
  }
  await ecrireBilan(appelId);
}

/**
 * Produit et enregistre le bilan d'un appel dont la transcription est connue, puis le classe dans sa campagne (sans
 * effet s'il l'est déjà) ; pour un appel entrant, retire la nouvelle tentative prévue. Peut être relancé.
 */
export async function analyserAppel(appelId: string): Promise<void> {
  await ecrireBilan(appelId);
  await apresBilan(appelId);
}

async function ecrireBilan(appelId: string): Promise<void> {
  const [appel] = await db.select().from(appels).where(eq(appels.id, appelId));
  if (!appel || appel.purgeLe) return;
  if (!appel.transcription) {
    const erreur = appel.conversationId
      ? 'La transcription n’a pas été rapatriée : rapatrie la conversation pour obtenir le bilan.'
      : 'Aucune transcription ni conversation pour cet appel : rien à analyser.';
    await db.update(appels).set({ statut: 'echec', erreur }).where(eq(appels.id, appelId));
    return;
  }
  await db.update(appels).set({ statut: 'traitement', traitementLe: new Date(), erreur: null }).where(eq(appels.id, appelId));

  const [[entreprise], [version], listeObjections, personnalisees, [rdv]] = await Promise.all([
    db.select().from(entreprises).where(eq(entreprises.id, appel.entrepriseId)),
    db.select().from(versionsScript).where(eq(versionsScript.id, appel.versionScriptId)),
    db.select().from(objections).where(eq(objections.entrepriseId, appel.entrepriseId)),
    db
      .select()
      .from(issuesPersonnalisees)
      .where(and(eq(issuesPersonnalisees.entrepriseId, appel.entrepriseId), eq(issuesPersonnalisees.archivee, false))),
    db.select().from(rendezVous).where(eq(rendezVous.appelId, appelId)),
  ]);
  if (!entreprise || !version) {
    const manque = entreprise ? 'la version de script' : 'l’entreprise';
    await db.update(appels).set({ statut: 'echec', erreur: `Analyse impossible : ${manque} de cet appel n’existe plus.` }).where(eq(appels.id, appelId));
    return;
  }

  const issues = [
    ...ISSUES_SYSTEME.map((i) => ({ cle: i as string, systeme: i, libelle: LIBELLES_ISSUES[i], sens: SENS_ISSUES[i] })),
    ...personnalisees.map((p) => ({
      cle: `perso:${p.id}`,
      systeme: p.issueSysteme,
      libelle: p.libelle,
      sens: `cas particulier de « ${LIBELLES_ISSUES[p.issueSysteme]} »`,
    })),
  ];

  try {
    const bilan = await analyser({
      contexte: {
        transcription: appel.transcription,
        nombreEtapes: version.etapes.length,
        objectionIds: listeObjections.map((o) => o.id),
        issues,
        rendezVousReserve: Boolean(rdv),
        debutAppel: appel.debutLe,
      },
      entreprise: entreprise.nom,
      sens: appel.sens,
      // Le nom de l'époque de l'appel : un renommage ne réécrit pas les bilans passés.
      assistante: appel.assistanteNom ?? (await lireAssistante()).nom,
      etapes: version.etapes.map((e) => e.intention),
      objections: listeObjections.map((o) => ({ id: o.id, libelle: o.libelle })),
      issues,
      rendezVous: rdv ? creneauParle(rdv.debut, entreprise.fuseau) : null,
    });
    await db
      .update(appels)
      .set({
        bilan,
        issue: bilan.issue,
        issueSysteme: issues.find((i) => i.cle === bilan.issue)?.systeme ?? null,
        // Réécrit à chaque analyse : une réanalyse qui n'est plus un rappel daté l'efface.
        rappelLe: bilan.rappelLe ? instantDuRappel(bilan.rappelLe) : null,
        versionAnalyseur: VERSION_ANALYSEUR,
        statut: 'termine',
      })
      .where(and(eq(appels.id, appelId), isNull(appels.purgeLe)));
  } catch (erreur) {
    await db.update(appels).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(appels.id, appelId));
  }
}

/** Le personnage que le modèle joue face à l'assistante, tiré de la fiche prospect. */
function personnage(variables: VariablesDeLAppel): string {
  return `Tu es ${variables.prospect_nom}, ${variables.prospect_role} chez ${variables.prospect_societe}. Tu décroches ton téléphone sans t'attendre à cet appel. Ce que l'on sait de toi : ${variables.prospect_contexte}
Tu es un vrai professionnel occupé : tu réponds court, comme au téléphone. Tu n'es pas facile à convaincre, tu soulèves au moins une objection réaliste, et tu ne dis oui à un rendez-vous que si on a vraiment écouté ce que tu dis. Tu peux aussi refuser, demander qu'on te rappelle, ou demander un mail.`;
}

/** Appel simulé : même contrôle du numéro qu'un vrai appel, puis conversation jouée par un modèle. */
export async function simulerAppel(appelId: string, variables: VariablesDeLAppel): Promise<void> {
  try {
    const transcription = await simulerConversation(variables, personnage(variables));
    const duree = Math.round(transcription.reduce((total, t) => total + t.texte.split(/\s+/).length / 2.6, 0));
    await db
      .update(appels)
      .set({ transcription, dureeSecondes: duree, finLe: new Date(), statut: 'traitement', traitementLe: new Date() })
      .where(eq(appels.id, appelId));
  } catch (erreur) {
    await db.update(appels).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(appels.id, appelId));
    return;
  }
  await analyserAppel(appelId);
}
