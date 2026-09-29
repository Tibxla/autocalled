import 'server-only';
import {
  type Campagne,
  type OrigineGeste,
  type VariablesDeLAppel,
  ajouterProspects,
  creerCampagne,
  debuterAppel,
  demarrer,
  finDemandee,
  mettreEnPause,
  prochaineAction,
  reporter,
  retirer,
  sauter,
  terminerAppel,
  terminerAvantLaFin,
  TransitionInvalide,
} from '@autocalled/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes, prospects, scripts, versionsScript } from '@/db/schema';
import { rafraichirSiAncien } from './agenda';
import { preparerAppel, simulerAppel } from './appels';
import { autorisationsDe } from './autorisations';
import { jetonConversation } from './elevenlabs';
import type { ResultatAction } from './formulaire';
import { commanderPont, reglagesDuPont, refusDuPont } from './pont';
import type { SaisieCampagne } from './schemas';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Nombre de prospects au plus dans une campagne, par l'interface comme par le MCP. */
export const PROSPECTS_MAX_CAMPAGNE = 200;

/** Refus d'une campagne sur un script archivé : l'interface ne le propose plus, un onglet resté ouvert ne passe pas. */
export const SCRIPT_ARCHIVE_CAMPAGNE = 'Ce script est archivé : il ne se lance plus. Choisis la version d’un autre script, ou réactive-le.';

/**
 * Pourquoi cette campagne ne peut pas être enregistrée (version d'une autre entreprise ou d'un script archivé,
 * prospect inconnu, file trop longue), ou null. Les mêmes contrôles que l'outil MCP, pour l'interface.
 */
export async function obstacleNouvelleCampagne(entrepriseId: string, saisie: SaisieCampagne): Promise<string | null> {
  if (saisie.prospects.length > PROSPECTS_MAX_CAMPAGNE) return `${PROSPECTS_MAX_CAMPAGNE} prospects au plus par campagne.`;
  const [version] = await db
    .select({ archive: scripts.archive })
    .from(versionsScript)
    .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(and(eq(versionsScript.id, saisie.versionScriptId), eq(scripts.entrepriseId, entrepriseId)));
  if (!version) return 'Cette version de script n’appartient pas à cette entreprise.';
  if (version.archive) return SCRIPT_ARCHIVE_CAMPAGNE;
  const ids = [...new Set(saisie.prospects)];
  const connus = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), inArray(prospects.id, ids)));
  const inconnus = ids.filter((id) => !connus.some((p) => p.id === id));
  return inconnus.length ? `Prospect introuvable dans cette entreprise : ${inconnus.join(', ')}.` : null;
}

/** Enregistre une campagne prête : rien ne sonne avant qu'on la lance. */
export async function enregistrerCampagne(entrepriseId: string, saisie: SaisieCampagne): Promise<string> {
  const campagne = creerCampagne({ id: crypto.randomUUID(), entrepriseId, versionScriptId: saisie.versionScriptId, prospectIds: saisie.prospects });
  await db.insert(campagnes).values({ ...campagne, ligne: saisie.ligne });
  return campagne.id;
}

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
  | { type: 'attente'; raison?: string };

/**
 * Ligne navigateur : passe au prochain prospect autorisé, en sautant ceux dont le numéro ne l'est
 * plus à cet instant, et ouvre la conversation. `attendu` : le prospect que la page affiche ; si la file a
 * changé entre-temps (Sauter, Retirer), rien ne part et la raison le dit.
 */
export async function appelerSuivantNavigateur(campagneId: string, attendu?: string): Promise<AppelSuivant> {
  return avecCampagne<AppelSuivant>(campagneId, async (campagne, tx) => {
    for (;;) {
      const action = prochaineAction(campagne);
      if (action.type !== 'appeler') return { campagne, resultat: { type: 'attente' } };
      if (attendu !== undefined && action.prospectId !== attendu) {
        return { campagne, resultat: { type: 'attente', raison: 'La file a changé : le prochain prospect n’est plus celui affiché. Rien n’est parti.' } };
      }
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
          assistanteNom: preparation.assistanteNom,
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

/**
 * Démarre (ou reprend) une campagne et renvoie sa ligne : à l'appelant d'enchaîner les appels, par
 * `derouleSimulation` ou `appelerSuivantTelephone`. Lève `TransitionInvalide` si elle n'est ni prête ni en pause.
 */
export async function demarrerCampagne(campagneId: string): Promise<'navigateur' | 'simulation' | 'bluetooth' | 'twilio' | null> {
  await avecCampagne(campagneId, async (c, tx) => {
    // Une campagne prête ne part pas sur un script archivé entre-temps ; une campagne en pause garde sa version.
    if (c.statut === 'prete') {
      const [version] = await tx
        .select({ archive: scripts.archive })
        .from(versionsScript)
        .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
        .where(eq(versionsScript.id, c.versionScriptId));
      if (version?.archive) throw new TransitionInvalide(SCRIPT_ARCHIVE_CAMPAGNE);
    }
    return { campagne: demarrer(c), resultat: null };
  });
  await rafraichirSiAncien();
  const [ligne] = await db.select({ ligne: campagnes.ligne }).from(campagnes).where(eq(campagnes.id, campagneId));
  return ligne?.ligne ?? null;
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
            assistanteNom: preparation.assistanteNom,
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

/** Pause entre deux appels téléphone d'une campagne, réglée sur la page Téléphone (5 s par défaut). */
export async function pauseEntreAppelsMs(): Promise<number> {
  return ((await reglagesDuPont())?.pauseEntreAppelsS ?? 5) * 1000;
}

/**
 * Ligne téléphone : le serveur enchaîne, un appel à la fois. Le pont compose ; la fin de l'appel
 * (route /api/pont/…/fin) clôt l'entrée et rappelle cette fonction, qui relit l'état (pause possible).
 */
export async function appelerSuivantTelephone(campagneId: string): Promise<void> {
  // Plafond atteint ou pont absent : pause, sans consommer le prospect suivant.
  if (await refusDuPont()) {
    await suspendreSiEnCours(campagneId);
    return;
  }
  const suivant = await avecCampagne<{
    appelId: string;
    numero: string;
    variables: VariablesDeLAppel;
    motsCles: string[];
    premierMessage: string;
  } | null>(
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
            assistanteNom: preparation.assistanteNom,
          })
          .returning({ id: appels.id });
        if (!appel) throw new Error('appel non enregistré');
        return {
          campagne: debuterAppel(campagne, action.prospectId, appel.id),
          resultat: {
            appelId: appel.id,
            numero: preparation.numero,
            variables: preparation.variables,
            motsCles: preparation.motsCles,
            premierMessage: preparation.premierMessage,
          },
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
    premierMessage: suivant.premierMessage,
  });
  if (reponse.ok) return;
  // Pont injoignable ou téléphone absent : l'appel échoue et la campagne se met en pause, plutôt que de
  // vider toute la file en échecs.
  await db.update(appels).set({ statut: 'echec', erreur: reponse.raison, finLe: new Date() }).where(eq(appels.id, suivant.appelId));
  await clore(campagneId, suivant.appelId);
  await suspendreSiEnCours(campagneId);
}

/** Met la campagne en pause si elle tourne ; sans effet sur une campagne prête, en pause ou terminée. */
export async function suspendreSiEnCours(campagneId: string): Promise<void> {
  try {
    await avecCampagne(campagneId, async (c) => ({ campagne: mettreEnPause(c), resultat: null }));
  } catch (erreur) {
    if (!(erreur instanceof TransitionInvalide)) throw erreur;
  }
}

/**
 * Supprime une campagne prête : rien n'a été appelé, elle se recrée en un geste (autre version, autre ligne).
 * Une campagne lancée, même terminée, est de l'historique et ne se supprime pas.
 */
export async function supprimerCampagnePrete(campagneId: string): Promise<ResultatAction> {
  if (!FORME_UUID.test(campagneId)) return { ok: false, raison: INTROUVABLE };
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ statut: campagnes.statut }).from(campagnes).where(eq(campagnes.id, campagneId)).for('update');
    if (!c) return { ok: false as const, raison: INTROUVABLE };
    if (c.statut !== 'prete') return { ok: false as const, raison: 'Seule une campagne prête (jamais lancée) se supprime : une campagne lancée est de l’historique. terminer_campagne l’arrête.' };
    if (await tx.$count(appels, eq(appels.campagneId, campagneId))) return { ok: false as const, raison: 'Cette campagne a déjà des appels : elle ne se supprime pas.' };
    await tx.delete(campagnes).where(eq(campagnes.id, campagneId));
    return { ok: true as const };
  });
}

/** Nombre d'appels d'une campagne par état, pour la liste. */
export const resumeEntrees = sql<string>`jsonb_path_query_array(${campagnes.entrees}, '$[*].etat')`;

/* ------------------------------------------------------------------ gestes sur la file */

const FILE_CHANGEE = 'La campagne a changé entre-temps : relis la page.';
const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTROUVABLE = 'Campagne introuvable.';

/**
 * Un geste de l'opérateur sur la file, sous le verrou de `avecCampagne`. Les refus attendus reviennent en
 * phrase (`ResultatAction`) ; une transition refusée par le domaine malgré les contrôles dit que la campagne a
 * changé entre-temps.
 */
async function gesteSurLaFile<T extends object>(
  campagneId: string,
  geste: (campagne: Campagne, tx: Transaction) => Promise<ResultatAction<T> | { campagne: Campagne; resultat: ResultatAction<T> }>,
): Promise<ResultatAction<T>> {
  if (!FORME_UUID.test(campagneId)) return { ok: false, raison: INTROUVABLE };
  try {
    return await avecCampagne<ResultatAction<T>>(campagneId, async (campagne, tx) => {
      const issue = await geste(campagne, tx);
      return 'campagne' in issue ? issue : { campagne, resultat: issue };
    });
  } catch (erreur) {
    if (!(erreur instanceof TransitionInvalide)) throw erreur;
    return { ok: false, raison: erreur.message === 'campagne introuvable' ? INTROUVABLE : FILE_CHANGEE };
  }
}

/** Pourquoi ce prospect ne peut plus bouger dans la file, ou null s'il est encore à appeler. */
function refusEntree(campagne: Campagne, prospectId: string): string | null {
  if (campagne.statut === 'terminee') return 'La campagne est terminée : sa file ne bouge plus.';
  const entree = campagne.entrees.find((e) => e.prospectId === prospectId);
  if (!entree) return 'Ce prospect n’est pas dans la file de cette campagne.';
  if (entree.etat === 'en-appel') return 'Ce prospect est en appel : l’appel va à son terme.';
  if (entree.etat !== 'a-appeler') return 'Ce prospect n’est plus à appeler dans cette campagne.';
  return null;
}

/**
 * « Sauter » : le prospect repasse en fin de file, sans être appelé maintenant. N'appelle personne ; une
 * campagne en cours enchaîne sur le suivant comme d'habitude.
 */
export async function sauterProspect(campagneId: string, prospectId: string): Promise<ResultatAction> {
  return gesteSurLaFile(campagneId, async (campagne) => {
    const refus = refusEntree(campagne, prospectId);
    if (refus) return { ok: false, raison: refus };
    const rang = campagne.entrees.findIndex((e) => e.prospectId === prospectId);
    if (!campagne.entrees.slice(rang + 1).some((e) => e.etat === 'a-appeler')) {
      return { ok: false, raison: 'C’est déjà le dernier prospect à appeler : il reste à sa place.' };
    }
    return { campagne: reporter(campagne, prospectId), resultat: { ok: true } };
  });
}

/**
 * Retire un prospect de la file : il ne sera pas appelé dans cette campagne. L'entrée reste, avec l'heure et
 * l'origine du geste. Retirer le dernier prospect restant termine la campagne (après l'appel en cours s'il y en a un).
 */
export async function retirerProspect(
  campagneId: string,
  prospectId: string,
  origine: OrigineGeste = 'interface',
): Promise<ResultatAction<{ terminee: boolean }>> {
  return gesteSurLaFile<{ terminee: boolean }>(campagneId, async (campagne) => {
    const refus = refusEntree(campagne, prospectId);
    if (refus) return { ok: false, raison: refus };
    const apres = retirer(campagne, prospectId, { le: new Date().toISOString(), par: origine });
    return { campagne: apres, resultat: { ok: true, terminee: apres.statut === 'terminee' } };
  });
}

/**
 * Ajoute des prospects en fin de file d'une campagne non terminée, avec les gardes du lancement : prospects de
 * l'entreprise, numéro autorisé à cet instant, script non archivé, aucun doublon. Tout ou rien : un seul
 * prospect refusé et rien n'est ajouté, la raison les nomme.
 */
export async function ajouterALaCampagne(campagneId: string, prospectIds: readonly string[]): Promise<ResultatAction<{ ajoutes: number }>> {
  const ids = [...new Set(prospectIds)];
  if (ids.length === 0) return { ok: false, raison: 'Choisis au moins un prospect.' };
  if (!FORME_UUID.test(campagneId)) return { ok: false, raison: INTROUVABLE };
  const [ligne] = await db
    .select({ entrepriseId: campagnes.entrepriseId, archive: scripts.archive })
    .from(campagnes)
    .innerJoin(versionsScript, eq(versionsScript.id, campagnes.versionScriptId))
    .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(eq(campagnes.id, campagneId));
  if (!ligne) return { ok: false, raison: INTROUVABLE };
  if (ligne.archive) {
    return { ok: false, raison: 'Le script de cette campagne est archivé : réactive-le dans Scripts, ou lance une nouvelle campagne sur un autre script.' };
  }
  const trouves = await db
    .select({ id: prospects.id, nom: prospects.nom, telephone: prospects.telephone })
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, ligne.entrepriseId), inArray(prospects.id, ids)));
  const inconnus = ids.filter((id) => !trouves.some((p) => p.id === id));
  if (inconnus.length) return { ok: false, raison: `Prospect introuvable dans cette entreprise : ${inconnus.join(', ')}. Rien n’a été ajouté.` };
  const autorisations = await autorisationsDe(trouves.map((p) => p.telephone));
  const nonAutorises = trouves.filter((p) => !autorisations.get(p.telephone)?.autorise);
  if (nonAutorises.length) {
    return { ok: false, raison: `Numéro non autorisé : ${nonAutorises.map((p) => p.nom).join(', ')}. Rien n’a été ajouté.` };
  }
  const nom = new Map(trouves.map((p) => [p.id, p.nom]));

  return gesteSurLaFile<{ ajoutes: number }>(campagneId, async (campagne) => {
    if (campagne.statut === 'terminee') return { ok: false, raison: 'La campagne est terminée : lance-en une nouvelle pour appeler ces prospects.' };
    if (finDemandee(campagne)) return { ok: false, raison: 'La campagne se termine après l’appel en cours : plus rien ne s’y ajoute.' };
    const deja = ids.filter((id) => campagne.entrees.some((e) => e.prospectId === id));
    if (deja.length) return { ok: false, raison: `Déjà dans la file : ${deja.map((id) => nom.get(id) ?? id).join(', ')}. Rien n’a été ajouté.` };
    return { campagne: ajouterProspects(campagne, ids), resultat: { ok: true, ajoutes: ids.length } };
  });
}

/**
 * Termine une campagne avant la fin : chaque prospect encore à appeler est retiré (trace gardée). Aucun appel
 * n'est coupé : sans appel en cours, la campagne est terminée tout de suite (`immediate`) ; sinon l'appel va à
 * son terme et la campagne se termine avec lui (`apres-appel`), sans enchaîner.
 */
export async function terminerCampagne(
  campagneId: string,
  origine: OrigineGeste = 'interface',
): Promise<ResultatAction<{ fin: 'immediate' | 'apres-appel' }>> {
  return gesteSurLaFile<{ fin: 'immediate' | 'apres-appel' }>(campagneId, async (campagne) => {
    if (campagne.statut === 'terminee') return { ok: false, raison: 'La campagne est déjà terminée.' };
    if (finDemandee(campagne)) return { ok: false, raison: 'La campagne se termine déjà à la fin de l’appel en cours.' };
    if (!campagne.entrees.some((e) => e.etat === 'a-appeler')) {
      return { ok: false, raison: 'Plus aucun prospect à appeler : la campagne se termine d’elle-même à la fin de l’appel en cours.' };
    }
    const apres = terminerAvantLaFin(campagne, { le: new Date().toISOString(), par: origine });
    return { campagne: apres, resultat: { ok: true, fin: apres.statut === 'terminee' ? 'immediate' : 'apres-appel' } };
  });
}
