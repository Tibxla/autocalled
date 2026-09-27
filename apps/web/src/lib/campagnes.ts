import 'server-only';
import { type Campagne, type VariablesDeLAppel, debuterAppel, mettreEnPause, prochaineAction, sauter, terminerAppel, TransitionInvalide } from '@autocalled/domain';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { preparerAppel, simulerAppel } from './appels';
import { jetonConversation } from './elevenlabs';
import { commanderPont } from './pont';

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
  | { type: 'appel'; appelId: string; prospectId: string; jeton: string; variables: Record<string, string>; motsCles: string[] }
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
        resultat: { type: 'appel', appelId: appel.id, prospectId: action.prospectId, jeton, variables: preparation.variables, motsCles: preparation.motsCles },
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

/** Pause entre deux appels téléphone d'une campagne, comme le décompte de la ligne navigateur. */
export const PAUSE_ENTRE_APPELS_MS = 5000;

/**
 * Ligne téléphone : le serveur enchaîne, un appel à la fois. Le pont compose ; la fin de l'appel
 * (route /api/pont/…/fin) clôt l'entrée et rappelle cette fonction, qui relit l'état (pause possible).
 */
export async function appelerSuivantTelephone(campagneId: string): Promise<void> {
  const suivant = await avecCampagne<{ appelId: string; numero: string; variables: VariablesDeLAppel; motsCles: string[] } | null>(
    campagneId,
    async (campagne, tx) => {
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
            ligne: 'bluetooth',
            numero: preparation.numero,
          })
          .returning({ id: appels.id });
        if (!appel) throw new Error('appel non enregistré');
        return {
          campagne: debuterAppel(campagne, action.prospectId, appel.id),
          resultat: { appelId: appel.id, numero: preparation.numero, variables: preparation.variables, motsCles: preparation.motsCles },
        };
      }
    },
  );
  if (!suivant) return;

  const reponse = await commanderPont('/appels', {
    appelId: suivant.appelId,
    numero: suivant.numero,
    variables: suivant.variables,
    motsCles: suivant.motsCles,
  });
  if (reponse.ok) return;
  // Pont injoignable ou téléphone absent : l'appel échoue et la campagne se met en pause, plutôt que de
  // vider toute la file en échecs.
  await db.update(appels).set({ statut: 'echec', erreur: reponse.raison, finLe: new Date() }).where(eq(appels.id, suivant.appelId));
  await clore(campagneId, suivant.appelId);
  try {
    await avecCampagne(campagneId, async (c) => ({ campagne: mettreEnPause(c), resultat: null }));
  } catch (erreur) {
    if (!(erreur instanceof TransitionInvalide)) throw erreur;
  }
}

/** Nombre d'appels d'une campagne par état, pour la liste. */
export const resumeEntrees = sql<string>`jsonb_path_query_array(${campagnes.entrees}, '$[*].etat')`;
