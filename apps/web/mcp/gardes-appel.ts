import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campagnes, entreprises, objections, versionsScript } from '@/db/schema';
import { numeroLisible } from '@/lib/format';
import { champ } from './confirmation';

/**
 * Ce que l'assistante dira au prospect vient de la fiche de l'entreprise, de ses objections, de la version du script
 * et de la fiche du prospect, relues à chaque appel (ADR 0010, amendement). Une campagne téléphone en cours enchaîne
 * les appels sans autre geste de l'opérateur : ce qui change ces textes pendant qu'elle tourne passe donc sous
 * confirmation, et les confirmations d'appel signalent ce que le MCP y a écrit.
 */

export const jourEtHeure = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Identifiants des campagnes téléphone en cours d'une entreprise. */
export async function campagnesTelephoneEnCours(entrepriseId: string): Promise<string[]> {
  const lignes = await db
    .select({ id: campagnes.id })
    .from(campagnes)
    .where(and(eq(campagnes.entrepriseId, entrepriseId), eq(campagnes.ligne, 'bluetooth'), eq(campagnes.statut, 'en-cours')));
  return lignes.map((l) => l.id);
}

/** La phrase qui dit, dans une question, qu'une campagne téléphone tourne et reprendra le changement sans autre geste. */
export function avertissementCampagne(ids: readonly string[]): string {
  return `${ids.length > 1 ? `${ids.length} campagnes téléphone sont en cours` : 'Une campagne téléphone est en cours'} pour cette entreprise : l’assistante le dira dès l’appel suivant, sans autre question.`;
}

/** Ce que le MCP a écrit en dernier dans les textes d'un appel de cette entreprise, avec cette version. */
export async function ecrituresDuMcp(entrepriseId: string, versionScriptId: string | null): Promise<string[]> {
  const [[e], [o], v] = await Promise.all([
    db.select({ par: entreprises.modifiePar, le: entreprises.modifieLe }).from(entreprises).where(eq(entreprises.id, entrepriseId)),
    db
      .select({ le: objections.modifieLe })
      .from(objections)
      .where(and(eq(objections.entrepriseId, entrepriseId), eq(objections.modifiePar, 'mcp'), eq(objections.archivee, false)))
      .orderBy(desc(objections.modifieLe))
      .limit(1),
    versionScriptId
      ? db.select({ par: versionsScript.creePar, le: versionsScript.creeLe }).from(versionsScript).where(eq(versionsScript.id, versionScriptId))
      : Promise.resolve([]),
  ]);
  return [
    e?.par === 'mcp' && `fiche de l’entreprise modifiée par le MCP le ${jourEtHeure.format(e.le)}`,
    o && `objection modifiée par le MCP le ${jourEtHeure.format(o.le)}`,
    v[0]?.par === 'mcp' && `version du script créée par le MCP le ${jourEtHeure.format(v[0].le)}`,
  ].filter((x): x is string => Boolean(x));
}

/** « Attention : … » en fin de question, ou rien. */
export const attentionMcp = (ecritures: readonly string[]) => (ecritures.length ? ` Attention : ${ecritures.join(' ; ')}.` : '');

/** Les prospects dont le numéro a été entré par le MCP, nommés un à un (vingt au plus, puis « et N autres »). */
export function numerosDuMcp(liste: readonly { nom: string; telephone: string; ajout: Date | null }[], max = 20): string {
  const parMcp = liste.filter((p): p is { nom: string; telephone: string; ajout: Date } => p.ajout !== null);
  if (!parMcp.length) return '';
  const noms = parMcp.slice(0, max).map((p) => `${champ(p.nom, 40)} (${numeroLisible(p.telephone)}), le ${jourEtHeure.format(p.ajout)}`);
  const reste = parMcp.length - max;
  return ` Numéro${parMcp.length > 1 ? 's' : ''} ajouté${parMcp.length > 1 ? 's' : ''} par le MCP : ${noms.join(' ; ')}${reste > 0 ? ` ; et ${reste} autre${reste > 1 ? 's' : ''}` : ''}.`;
}
