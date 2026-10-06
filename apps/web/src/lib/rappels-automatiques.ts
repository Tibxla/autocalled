import 'server-only';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, prospects } from '@/db/schema';
import { preparerAppel } from './appels';
import { dansLesHeuresDAppel } from './heures-appel';
import { commanderPont, disponibiliteLigne } from './pont';
import { RAPPEL_A_FAIRE } from './rappels';

type Lecteur = Pick<typeof db, 'select'>;
/** Refus certains avant composition. Un 5xx peut arriver après une programmation dans GLib : état incertain. */
const REFUS_AVANT_COMPOSITION = new Set([400, 401, 403, 404, 409, 429]);

/** Une activation explicite : les anciens rappels en retard restent manuels. Absente ou invalide, aucun départ. */
export function activationRappelsAutomatiques(): Date | null {
  const lu = z.iso.datetime({ offset: true }).safeParse(process.env.RAPPELS_AUTOMATIQUES_DEPUIS);
  return lu.success ? new Date(lu.data) : null;
}

/** Indication sur la fiche : un rappel futur aussi peut être annoncé comme automatique. */
export function rappelSeraAutomatique({ ligne, rappelLe }: { ligne: string; rappelLe: Date | null }): boolean {
  const activation = activationRappelsAutomatiques();
  return ligne === 'bluetooth' && activation !== null && rappelLe !== null && rappelLe.getTime() >= activation.getTime();
}

/** Rappels datés, dus depuis l'activation, encore à faire. Ne consulte pas le pont et n'écrit rien. */
export async function rappelsAutomatiquesDus(maintenant: Date, lecteur: Lecteur = db, appelId?: string) {
  const activation = activationRappelsAutomatiques();
  if (!activation) return [];
  return lecteur
    .select({ appelId: appels.id, entrepriseId: appels.entrepriseId, prospectId: appels.prospectId, versionScriptId: appels.versionScriptId })
    .from(appels)
    .innerJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .where(and(
      eq(appels.statut, 'termine'),
      eq(appels.ligne, 'bluetooth'),
      gte(appels.rappelLe, activation),
      lte(appels.rappelLe, maintenant),
      isNull(prospects.archiveLe),
      RAPPEL_A_FAIRE,
      appelId ? eq(appels.id, appelId) : undefined,
    ))
    .orderBy(asc(appels.rappelLe), asc(appels.id));
}

/**
 * Un seul réveil compose à la fois. L'éligibilité est relue sous verrou, puis au dernier moment ; un appel entrant
 * avec conversation ou un sortant plus récent annule le rappel. L'appel source fournit sa version de script.
 * Le refus du pont avant composition ne solde pas le rappel : l'enregistrement provisoire est retiré.
 */
export async function rappelerSiDu(appelSourceId: string, maintenant: Date): Promise<boolean> {
  if (!dansLesHeuresDAppel(maintenant) || !activationRappelsAutomatiques()) return false;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('autocalled:rappels-automatiques'))`);
    const [source] = await rappelsAutomatiquesDus(maintenant, tx, appelSourceId);
    if (!source) return false;
    if ((await disponibiliteLigne()).type !== 'libre') return false;
    const preparation = await preparerAppel(source.entrepriseId, source.prospectId, source.versionScriptId, {
      situation: 'Tu rappelles ce prospect à l’heure convenue lors de votre dernier échange. Présente-toi brièvement, dis que tu rappelles comme convenu et reprends le sujet de cet échange à partir de l’historique. Ne récite pas à nouveau l’accroche de prospection et vérifie que c’est un bon moment pour parler.',
      ouvertureScript: false,
    });
    if (!preparation.ok || !(await rappelsAutomatiquesDus(maintenant, tx, appelSourceId)).length) return false;
    // Écrit hors de la transaction du verrou : les routes du pont doivent voir cet appel dès sa composition.
    const [appel] = await db.insert(appels).values({
      entrepriseId: source.entrepriseId,
      prospectId: source.prospectId,
      versionScriptId: source.versionScriptId,
      ligne: 'bluetooth',
      numero: preparation.numero,
      assistanteNom: preparation.assistanteNom,
    }).returning({ id: appels.id });
    if (!appel) return false;
    const reponse = await commanderPont('/appels', {
      appelId: appel.id,
      numero: preparation.numero,
      variables: preparation.variables,
      motsCles: preparation.motsCles,
      premierMessage: preparation.premierMessage,
    });
    if (reponse.ok) return true;
    // Une réponse réseau perdue peut cacher un départ accepté : le pont ou une conversation en base le confirme.
    const incertain = reponse.statut === undefined || !REFUS_AVANT_COMPOSITION.has(reponse.statut);
    const etat = incertain ? await commanderPont('/etat') : null;
    if (etat?.ok && etat.corps.appelId === appel.id) return true;
    if (incertain) {
      // Libre ne prouve pas qu'il n'a pas composé : l'appel a pu déjà finir. On conserve sa trace pour empêcher
      // une seconde composition. L'opérateur peut vérifier le pont, puis rappeler manuellement si nécessaire.
      await db.update(appels).set({
        statut: 'echec',
        erreur: 'Composition incertaine : le pont n’a pas confirmé si le téléphone a composé. Vérifie le téléphone avant de rappeler manuellement.',
        finLe: new Date(),
      }).where(and(eq(appels.id, appel.id), eq(appels.statut, 'en-cours'), isNull(appels.conversationId)));
      return false;
    }
    const retires = await db.delete(appels)
      .where(and(eq(appels.id, appel.id), eq(appels.statut, 'en-cours'), isNull(appels.conversationId)))
      .returning({ id: appels.id });
    return retires.length === 0;
  });
}
