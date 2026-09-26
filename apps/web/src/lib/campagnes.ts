import 'server-only';
import { type Campagne, type VariablesDeLAppel, debuterAppel, prochaineAction, sauter, terminerAppel, TransitionInvalide } from '@autocalled/domain';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { preparerAppel, simulerAppel } from './appels';
import { jetonConversation } from './elevenlabs';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Applique une transition du domaine à une campagne, sous verrou de ligne : deux actions
 * simultanées (deux onglets, un clic doublé) ne peuvent pas lancer deux appels.
 */
export async function avecCampagne<T>(
  id: string,
  transition: (campagne: Campagne, tx: Transaction) => Promise<{ campagne: Campagne; resultat: T }>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [ligne] = await tx.select().from(campagnes).where(eq(campagnes.id, id)).for('update');
    if (!ligne) throw new TransitionInvalide('campagne introuvable');
    const { campagne, resultat } = await transition(
      { id: ligne.id, entrepriseId: ligne.entrepriseId, versionScriptId: ligne.versionScriptId, statut: ligne.statut, entrees: ligne.entrees },
      tx,
    );
    await tx.update(campagnes).set({ statut: campagne.statut, entrees: campagne.entrees }).where(eq(campagnes.id, id));
    return resultat;
  });
}

export type AppelSuivant =
  | { type: 'appel'; appelId: string; prospectId: string; jeton: string; variables: Record<string, string> }
  | { type: 'attente' };

/**
 * Ligne navigateur : passe au prochain prospect autorisé, en sautant ceux dont le numéro ne l'est
 * plus à cet instant, et ouvre la conversation.
 */
export async function appelerSuivantNavigateur(campagneId: string): Promise<AppelSuivant> {
  return avecCampagne<AppelSuivant>(campagneId, async (campagne, tx) => {
    for (;;) {
      const action = prochaineAction(campagne);
      if (action.type !== 'appeler') return { campagne, resultat: { type: 'attente' } };
      const preparation = await preparerAppel(campagne.entrepriseId, action.prospectId, campagne.versionScriptId);
      if (!preparation.ok) {
        campagne = sauter(campagne, action.prospectId, 'numero-non-autorise');
        continue;
      }
      const { jeton, conversationId } = await jetonConversation();
      const [appel] = await tx
        .insert(appels)
        .values({
          entrepriseId: campagne.entrepriseId,
          prospectId: action.prospectId,
          versionScriptId: campagne.versionScriptId,
          campagneId,
          ligne: 'navigateur',
          numero: preparation.numero,
          conversationId,
        })
        .returning({ id: appels.id });
      if (!appel) throw new Error('appel non enregistré');
      return {
        campagne: debuterAppel(campagne, action.prospectId, appel.id),
        resultat: { type: 'appel', appelId: appel.id, prospectId: action.prospectId, jeton, variables: preparation.variables },
      };
    }
  });
}

export async function clore(campagneId: string, appelId: string): Promise<void> {
  await avecCampagne(campagneId, async (campagne) => ({ campagne: terminerAppel(campagne, appelId), resultat: null }));
}

/** Ligne simulation : le serveur enchaîne toute la campagne, en relisant l'état à chaque appel (pause possible). */
export async function derouleSimulation(campagneId: string): Promise<void> {
  for (;;) {
    const suivant = await avecCampagne<{ appelId: string; variables: Record<string, string> } | null>(campagneId, async (campagne, tx) => {
      for (;;) {
        const action = prochaineAction(campagne);
        if (action.type !== 'appeler') return { campagne, resultat: null };
        const preparation = await preparerAppel(campagne.entrepriseId, action.prospectId, campagne.versionScriptId);
        if (!preparation.ok) {
          campagne = sauter(campagne, action.prospectId, 'numero-non-autorise');
          continue;
        }
        const [appel] = await tx
          .insert(appels)
          .values({
            entrepriseId: campagne.entrepriseId,
            prospectId: action.prospectId,
            versionScriptId: campagne.versionScriptId,
            campagneId,
            ligne: 'simulation',
            numero: preparation.numero,
          })
          .returning({ id: appels.id });
        if (!appel) throw new Error('appel non enregistré');
        return {
          campagne: debuterAppel(campagne, action.prospectId, appel.id),
          resultat: { appelId: appel.id, variables: preparation.variables },
        };
      }
    });
    if (!suivant) return;
    await simulerAppel(suivant.appelId, suivant.variables as VariablesDeLAppel);
    await clore(campagneId, suivant.appelId);
  }
}

/** Nombre d'appels d'une campagne par état, pour la liste. */
export const resumeEntrees = sql<string>`jsonb_path_query_array(${campagnes.entrees}, '$[*].etat')`;
