import 'server-only';
import { prochaineAction } from '@autocalled/domain';
import { and, eq, inArray, isNull, lt, ne } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { rafraichirSiAncien } from './agenda';
import { classerDansSaCampagne, relancerSiDu } from './campagnes';
import { rappelerSiDu, rappelsAutomatiquesDus } from './rappels-automatiques';
import { dansLesHorairesRappels, lireReglagesRappels } from './reglages-rappels';

export { dansLesHeuresDAppel, HEURES_D_APPEL } from './heures-appel';

/**
 * Réveil des campagnes (scripts/reveil-campagnes.ts, toutes les 5 minutes) : rien d'autre ne relance une campagne
 * téléphone dont la prochaine tentative tombe demain à 9 h ou 14 h. Il rattrape aussi un classement perdu (une entrée
 * restée « en analyse » alors que son appel a déjà son bilan, ou a échoué), et passe en échec un appel entrant que le
 * pont n'a jamais pris en charge (sa décision est arrivée trop tard : aucune fin ne viendra). Jamais une campagne en pause.
 */

/**
 * Au-delà, un appel entrant toujours en cours sans conversation est orphelin : la durée maximale d'un appel du pont est
 * de 6 minutes, et un entrant décroché a sa conversation dans les secondes qui suivent.
 */
const ENTRANT_ORPHELIN_MS = 10 * 60_000;

/**
 * Le minuteur ne relance une campagne qu'entre 9 h et 19 h, heure de Paris, tous les jours : une campagne laissée en
 * cours le soir avec quelqu'un de dû ne fait pas sonner un téléphone la nuit. Classement et orphelins, eux, tournent à
 * toute heure. Les nouvelles tentatives tombent à 9 h ou 14 h, donc dans la plage.
 */
const ERREUR_ORPHELIN = 'Le pont n’a jamais pris cet appel entrant (réponse de l’application arrivée trop tard) : le téléphone a sonné sans réponse.';

type Lecteur = Pick<typeof db, 'select'>;

export interface PlanReveil {
  /** Les appels finis dont l'entrée attend encore son classement. */
  aClasser: { campagneId: string; appelId: string }[];
  /** Les campagnes téléphone en cours, sans appel en ligne, qui ont quelqu'un à appeler maintenant. */
  aRelancer: string[];
  /** Les appels entrants restés en cours sans conversation depuis plus de 10 minutes, à passer en échec. */
  orphelins: string[];
  /** Les appels source de rappels convenus datés encore à faire et dus depuis l'activation explicite. */
  aRappeler: string[];
}

/** Ce que le réveil ferait à cet instant ; ne lit que la base (pas le pont), n'écrit rien. */
export async function planReveil(maintenant: Date, lecteur: Lecteur = db): Promise<PlanReveil> {
  const ouvertes = await lecteur
    .select({
      id: campagnes.id,
      entrepriseId: campagnes.entrepriseId,
      versionScriptId: campagnes.versionScriptId,
      statut: campagnes.statut,
      ligne: campagnes.ligne,
      entrees: campagnes.entrees,
    })
    .from(campagnes)
    .where(ne(campagnes.statut, 'terminee'))
    .orderBy(campagnes.creeLe);

  const enAnalyse = ouvertes.flatMap((c) => c.entrees.flatMap((e) => (e.etat === 'en-analyse' ? [{ campagneId: c.id, appelId: e.appelId }] : [])));
  const finis = enAnalyse.length
    ? await lecteur
        .select({ id: appels.id })
        .from(appels)
        .where(
          and(
            inArray(
              appels.id,
              enAnalyse.map((e) => e.appelId),
            ),
            inArray(appels.statut, ['termine', 'echec']),
          ),
        )
    : [];
  const fini = new Set(finis.map((a) => a.id));
  const orphelins = await lecteur
    .select({ id: appels.id })
    .from(appels)
    .where(
      and(
        eq(appels.sens, 'entrant'),
        eq(appels.statut, 'en-cours'),
        isNull(appels.conversationId),
        lt(appels.debutLe, new Date(maintenant.getTime() - ENTRANT_ORPHELIN_MS)),
      ),
    );

  return {
    aClasser: enAnalyse.filter((e) => fini.has(e.appelId)),
    aRelancer: ouvertes.filter((c) => c.ligne === 'bluetooth' && prochaineAction(c, maintenant).type === 'appeler').map((c) => c.id),
    orphelins: orphelins.map((a) => a.id),
    aRappeler: dansLesHorairesRappels(maintenant, (await lireReglagesRappels(lecteur)).valeur)
      ? (await rappelsAutomatiquesDus(maintenant, lecteur)).map((a) => a.appelId) : [],
  };
}

/**
 * Classe ce qui doit l'être, appelle d'abord les rappels convenus dus, puis relance les campagnes dues : il n'y a qu'une ligne, la première
 * qui compose l'occupe et les suivantes attendent le prochain réveil (ou la fin de cet appel). Renvoie ce qui a été fait.
 */
export async function reveiller(
  maintenant = new Date(),
  { relancer = true, relancerCampagnes = true }: { relancer?: boolean; relancerCampagnes?: boolean } = {},
): Promise<{ classes: number; relancees: string[]; orphelins: number; rappeles: string[] }> {
  const { aClasser, orphelins } = await planReveil(maintenant);
  // Sans fin : la ligne refuserait l'archivage et l'effacement de ce prospect pour toujours. Seulement si elle n'a pas bougé.
  if (orphelins.length) {
    await db
      .update(appels)
      .set({ statut: 'echec', erreur: ERREUR_ORPHELIN })
      .where(and(inArray(appels.id, orphelins), eq(appels.statut, 'en-cours'), isNull(appels.conversationId)));
  }
  for (const { appelId } of aClasser) await classerDansSaCampagne(appelId, { relancer: false });
  if (!relancer) return { classes: aClasser.length, relancees: [], orphelins: orphelins.length, rappeles: [] };
  // Relu après les classements : un appel ancien enfin classé peut avoir une nouvelle tentative déjà due.
  const { aRelancer, aRappeler } = await planReveil(maintenant);
  // Souvent le premier appel de la journée : les créneaux proposés viennent d'une copie de l'agenda relue juste avant.
  const rappels = aRappeler;
  const campagnesDansLesHeures = relancerCampagnes ? aRelancer : [];
  if (campagnesDansLesHeures.length || rappels.length) await rafraichirSiAncien({ attendre: true });
  const rappeles: string[] = [];
  for (const id of rappels) if (await rappelerSiDu(id, maintenant)) rappeles.push(id);
  const relancees: string[] = [];
  for (const id of campagnesDansLesHeures) if (await relancerSiDu(id, maintenant)) relancees.push(id);
  return { classes: aClasser.length, relancees, orphelins: orphelins.length, rappeles };
}

/** Le compte rendu du réveil, sans nom ni numéro : des comptes et des identifiants de campagnes. */
export function compteRenduReveil(fait: { classes: number; relancees: readonly string[]; orphelins: number; rappeles: readonly string[] }, essai: boolean): string {
  const verbe = essai
    ? { classe: 'à classer', relance: 'à relancer', orphelin: 'à passer en échec' }
    : { classe: 'classé(s)', relance: 'relancée(s)', orphelin: 'passé(s) en échec' };
  const lignes = [
    `${essai ? 'Essai, rien n’est écrit ni composé. ' : ''}Appels ${verbe.classe} : ${fait.classes}.`,
    `Campagnes ${verbe.relance} : ${fait.relancees.length}${fait.relancees.length ? ` (${fait.relancees.join(', ')})` : ''}.`,
    `Appels entrants sans fin ${verbe.orphelin} : ${fait.orphelins}.`,
    `Rappels convenus ${essai ? 'à appeler' : 'lancés'} : ${fait.rappeles.length}.`,
  ];
  return lignes.join('\n');
}
