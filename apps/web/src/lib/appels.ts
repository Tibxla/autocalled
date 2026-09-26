import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ISSUES_SYSTEME,
  LIBELLES_ISSUES,
  type NumeroAutorise,
  SENS_ISSUES,
  type VariablesDeLAppel,
  variablesDeLAppel,
} from '@autocalled/domain';
import { creneauParle } from '@autocalled/agenda';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees, objections, prospects, rendezVous, versionsScript } from '@/db/schema';
import { VERSION_ANALYSEUR, analyser } from './analyseur';
import { autorisationsDe } from './autorisations';
import { audioConversation, lireConversation, simulerConversation } from './elevenlabs';

/** Dossier des enregistrements, hors dépôt (sauvegardé par Restic avec le reste du serveur). */
export function dossierDonnees(): string {
  return process.env.DOSSIER_DONNEES ?? join(process.cwd(), '..', '..', 'data');
}

const libelleIssue = new Map<string, string>(ISSUES_SYSTEME.map((i) => [i, LIBELLES_ISSUES[i]]));

export type PreparationAppel =
  | { ok: true; numero: NumeroAutorise; variables: VariablesDeLAppel; entrepriseId: string }
  | { ok: false; raison: string };

/**
 * Tout ce qu'il faut pour appeler un prospect, vérifié au dernier moment : le numéro doit être
 * autorisé à l'instant même, quelle que soit la ligne.
 */
export async function preparerAppel(entrepriseId: string, prospectId: string, versionScriptId: string): Promise<PreparationAppel> {
  const [entreprise] = await db.select().from(entreprises).where(eq(entreprises.id, entrepriseId));
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  const [version] = await db.select().from(versionsScript).where(eq(versionsScript.id, versionScriptId));
  if (!entreprise || !prospect || !version) return { ok: false, raison: 'Prospect ou version de script introuvable.' };

  const autorisation = (await autorisationsDe([prospect.telephone])).get(prospect.telephone);
  if (!autorisation?.autorise) {
    return { ok: false, raison: 'Ce numéro n’est pas autorisé : aucun consentement actif.' };
  }

  const [listeObjections, precedents] = await Promise.all([
    db
      .select()
      .from(objections)
      .where(and(eq(objections.entrepriseId, entrepriseId), eq(objections.archivee, false)))
      .orderBy(asc(objections.ordre)),
    db
      .select({ le: appels.debutLe, issue: appels.issue, bilan: appels.bilan })
      .from(appels)
      .where(and(eq(appels.entrepriseId, entrepriseId), eq(appels.prospectId, prospectId), isNotNull(appels.bilan)))
      .orderBy(desc(appels.debutLe))
      .limit(5),
  ]);

  const variables = variablesDeLAppel({
    entreprise,
    prospect,
    etapes: version.etapes,
    objections: listeObjections,
    historique: precedents.map((p) => ({
      le: p.le,
      issue: libelleIssue.get(p.issue ?? '') ?? p.issue ?? 'issue inconnue',
      resume: p.bilan?.resume ?? '',
    })),
    maintenant: new Date(),
    fuseau: entreprise.fuseau,
  });
  return { ok: true, numero: autorisation.numero, variables, entrepriseId };
}

/** Rapatrie la conversation terminée (transcription, durée, audio) puis lance l'analyse. */
export async function traiterAppel(appelId: string): Promise<void> {
  const [appel] = await db.select().from(appels).where(eq(appels.id, appelId));
  if (!appel?.conversationId) return;
  await db.update(appels).set({ statut: 'traitement', finLe: appel.finLe ?? new Date() }).where(eq(appels.id, appelId));

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
      await mkdir(dossier, { recursive: true });
      audio = `enregistrements/${appelId}.mp3`;
      await writeFile(join(dossierDonnees(), audio), Buffer.from(await audioConversation(appel.conversationId)));
    }

    await db
      .update(appels)
      .set({
        transcription: conversation.transcription,
        dureeSecondes: conversation.dureeSecondes,
        versionAgent: conversation.versionAgent,
        audio,
      })
      .where(eq(appels.id, appelId));
  } catch (erreur) {
    await db.update(appels).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(appels.id, appelId));
    return;
  }
  await analyserAppel(appelId);
}

/** Produit et enregistre le bilan d'un appel dont la transcription est connue. Peut être relancé. */
export async function analyserAppel(appelId: string): Promise<void> {
  const [appel] = await db.select().from(appels).where(eq(appels.id, appelId));
  if (!appel?.transcription) return;
  await db.update(appels).set({ statut: 'traitement', erreur: null }).where(eq(appels.id, appelId));

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
  if (!entreprise || !version) return;

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
      },
      entreprise: entreprise.nom,
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
        versionAnalyseur: VERSION_ANALYSEUR,
        statut: 'termine',
      })
      .where(eq(appels.id, appelId));
  } catch (erreur) {
    await db.update(appels).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(appels.id, appelId));
  }
}

/** Le personnage que le modèle joue face à Mina, tiré de la fiche prospect. */
function personnage(variables: VariablesDeLAppel): string {
  return `Tu es ${variables.prospect_nom}, ${variables.prospect_role} chez ${variables.prospect_societe}. Tu décroches ton téléphone sans t'attendre à cet appel. Ce que l'on sait de toi : ${variables.prospect_contexte}
Tu es un vrai professionnel occupé : tu réponds court, comme au téléphone. Tu n'es pas facile à convaincre, tu soulèves au moins une objection réaliste, et tu ne dis oui à un rendez-vous que si on a vraiment écouté ce que tu dis. Tu peux aussi refuser, demander qu'on te rappelle, ou demander un mail.`;
}

/** Appel simulé : même contrôle d'autorisation qu'un vrai appel, puis conversation jouée par un modèle. */
export async function simulerAppel(appelId: string, variables: VariablesDeLAppel): Promise<void> {
  try {
    const transcription = await simulerConversation(variables, personnage(variables));
    const duree = Math.round(transcription.reduce((total, t) => total + t.texte.split(/\s+/).length / 2.6, 0));
    await db
      .update(appels)
      .set({ transcription, dureeSecondes: duree, finLe: new Date(), statut: 'traitement' })
      .where(eq(appels.id, appelId));
  } catch (erreur) {
    await db.update(appels).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(appels.id, appelId));
    return;
  }
  await analyserAppel(appelId);
}
