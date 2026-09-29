import 'server-only';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { purgerBilan } from '@autocalled/domain';
import { and, eq, inArray, isNotNull, isNull, lt, not, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, journalMcp, rendezVous } from '@/db/schema';
import { DUREE_MAX_ANALYSE_S, dossierDonnees } from './appels';
import { supprimerFichier } from './effacement';

/**
 * Durée de conservation des données des appels (ADR 0014). Passé `DUREE_CONSERVATION_MOIS` après son début, un appel
 * perd ses enregistrements (celui de l'application, le son et le journal du pont), sa transcription, le texte libre
 * de son bilan (résumé, citations, libellés d'objections nouvelles, points forts et faibles, rappel dit), le texte de
 * son erreur et l'adresse d'invitation de son rendez-vous. Restent l'issue, l'étape atteinte, les objections par
 * identifiant avec leur levée et leur temps CRAC, la durée, les dates, la ligne et les versions (script, agent,
 * analyseur) : l'analyse des versions et les comptes ne bougent pas. Les lignes du journal MCP plus vieilles que la
 * durée sont supprimées. La liste d'opposition n'est jamais touchée.
 *
 * Lancée chaque jour par `autocalled-purge.timer` (scripts/purger.ts). Idempotente : un appel purgé ne l'est pas deux
 * fois. `inventairePurge` ne fait que lire (base et disque) ; seule `purger` écrit.
 */

export const DUREE_CONSERVATION_DEFAUT_MOIS = 12;

/** La durée de conservation en mois : `DUREE_CONSERVATION_MOIS`, 12 par défaut, 1 au moins. Refuse une valeur illisible. */
export function dureeConservationMois(valeur = process.env.DUREE_CONSERVATION_MOIS): number {
  const brute = valeur?.trim();
  if (!brute) return DUREE_CONSERVATION_DEFAUT_MOIS;
  if (!/^-?\d+$/.test(brute)) throw new Error(`DUREE_CONSERVATION_MOIS doit être un nombre entier de mois (lu : « ${brute.slice(0, 20)} »).`);
  return Math.max(1, Number(brute));
}

/**
 * Ce que l'interface et le MCP disent d'un appel purgé, avec la durée réglée aujourd'hui. Ne lève jamais : une durée
 * illisible donne la phrase sans chiffre (la purge, elle, refuse de tourner).
 */
export function mentionPurge(avecBilan = true): string {
  let apres = 'après la durée de conservation';
  try {
    apres = `après ${dureeConservationMois()} mois`;
  } catch {
    // Laissé sans chiffre.
  }
  return avecBilan
    ? `Bilan purgé ${apres} : détail effacé, issue et étapes conservées.`
    : `Appel purgé ${apres} : enregistrement, transcription et détail effacés.`;
}

/** L'instant avant lequel un appel est purgé : `mois` mois de calendrier avant `maintenant` (le 31 devient le dernier jour du mois). */
export function limiteConservation(maintenant: Date, mois: number): Date {
  const d = new Date(maintenant);
  const jour = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - mois);
  const dernierJour = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(jour, dernierJour));
  return d;
}

type Lecteur = Pick<typeof db, 'select' | '$count'>;

/** Un appel en analyse depuis peu : sa transcription ou son bilan peuvent encore s'écrire. Il sera purgé au passage suivant. */
function enAnalyse(maintenant: Date) {
  const recente = new Date(maintenant.getTime() - DUREE_MAX_ANALYSE_S * 1000).toISOString();
  return sql<boolean>`(${appels.statut} = 'traitement' and coalesce(${appels.traitementLe}, ${appels.finLe}, ${appels.debutLe}) > ${recente}::timestamptz)`;
}

/** Les appels passés la durée, pas encore purgés. */
const aPurger = (limite: Date) => and(isNull(appels.purgeLe), lt(appels.debutLe, limite));

/** Les fichiers d'un appel dans le dossier de données, relatifs : l'enregistrement de l'application, puis ceux du pont. */
function fichiersDe(a: { id: string; audio: string | null }): string[] {
  return [...new Set([...(a.audio ? [a.audio] : []), join('enregistrements', `${a.id}.mp3`), join('pont', `${a.id}.wav`), join('pont', `${a.id}.log`)])];
}

async function existe(relatif: string): Promise<boolean> {
  try {
    await access(join(dossierDonnees(), relatif));
    return true;
  } catch {
    return false;
  }
}

/** Ce qu'une purge ferait maintenant, en comptes seulement (aucun nom, numéro ni identifiant). */
export interface InventairePurge {
  dureeMois: number;
  /** Début d'appel avant lequel on purge (ISO). */
  limite: string;
  appels: number;
  transcriptions: number;
  bilans: number;
  erreurs: number;
  /** Adresses d'invitation de rendez-vous. */
  invitations: number;
  /** Fichiers présents sur le disque (dossier de données de ce processus). */
  fichiers: number;
  /** Appels passés la durée mais en cours d'analyse : purgés au passage suivant. */
  reportes: number;
  /** Lignes du journal MCP plus vieilles que la durée. */
  journal: number;
}

/**
 * Ce que `purger` ferait maintenant, compté dans la base et sur le disque. Lecture seule : que des `select` et des
 * tests d'existence de fichiers. `lecteur` permet de le lancer dans une transaction en lecture seule (`--essai`).
 */
export async function inventairePurge(maintenant = new Date(), o: { mois?: number; lecteur?: Lecteur } = {}): Promise<InventairePurge> {
  const mois = o.mois ?? dureeConservationMois();
  const lecteur = o.lecteur ?? db;
  const limite = limiteConservation(maintenant, mois);
  const candidats = await lecteur
    .select({
      id: appels.id,
      audio: appels.audio,
      transcrit: sql<boolean>`${appels.transcription} is not null`,
      analyse: sql<boolean>`${appels.bilan} is not null`,
      erreur: sql<boolean>`${appels.erreur} is not null`,
      reporte: enAnalyse(maintenant),
    })
    .from(appels)
    .where(aPurger(limite));
  const retenus = candidats.filter((a) => !a.reporte);
  const ids = retenus.map((a) => a.id);
  const [invitations, journal] = await Promise.all([
    ids.length ? lecteur.$count(rendezVous, and(inArray(rendezVous.appelId, ids), isNotNull(rendezVous.email))) : Promise.resolve(0),
    lecteur.$count(journalMcp, lt(journalMcp.le, limite)),
  ]);
  let fichiers = 0;
  for (const a of retenus) for (const f of fichiersDe(a)) if (await existe(f)) fichiers += 1;
  return {
    dureeMois: mois,
    limite: limite.toISOString(),
    appels: retenus.length,
    transcriptions: retenus.filter((a) => a.transcrit).length,
    bilans: retenus.filter((a) => a.analyse).length,
    erreurs: retenus.filter((a) => a.erreur).length,
    invitations,
    fichiers,
    reportes: candidats.length - retenus.length,
    journal,
  };
}

/** Ce qu'une purge a fait : des comptes, et les fichiers qu'elle n'a pas pu supprimer (chemins relatifs, sans nom). */
export interface ResultatPurge {
  dureeMois: number;
  limite: string;
  appels: number;
  transcriptions: number;
  bilans: number;
  erreurs: number;
  invitations: number;
  fichiers: number;
  reportes: number;
  journal: number;
  /** Appels laissés entiers parce qu'un de leurs fichiers résiste : repris au passage suivant. */
  fichiersEnEchec: string[];
}

/**
 * Purge les appels passés la durée de conservation et le journal MCP (voir l'en-tête du module). Appel par appel :
 * les fichiers d'abord, puis la base d'un bloc ; un appel dont un fichier résiste reste entier en base et sera repris
 * au passage suivant (un appel marqué purgé n'a plus aucun fichier). Un appel en cours d'analyse est reporté.
 */
export async function purger(maintenant = new Date(), o: { mois?: number } = {}): Promise<ResultatPurge> {
  const mois = o.mois ?? dureeConservationMois();
  const limite = limiteConservation(maintenant, mois);
  const candidats = await db
    .select({
      id: appels.id,
      audio: appels.audio,
      bilan: appels.bilan,
      transcrit: sql<boolean>`${appels.transcription} is not null`,
      erreur: sql<boolean>`${appels.erreur} is not null`,
      reporte: enAnalyse(maintenant),
    })
    .from(appels)
    .where(aPurger(limite))
    .orderBy(appels.debutLe);

  const r: ResultatPurge = {
    dureeMois: mois,
    limite: limite.toISOString(),
    appels: 0,
    transcriptions: 0,
    bilans: 0,
    erreurs: 0,
    invitations: 0,
    fichiers: 0,
    reportes: 0,
    journal: 0,
    fichiersEnEchec: [],
  };
  for (const a of candidats) {
    if (a.reporte) {
      r.reportes += 1;
      continue;
    }
    let echec = false;
    let supprimes = 0;
    for (const relatif of fichiersDe(a)) {
      try {
        if (await supprimerFichier(relatif)) supprimes += 1;
      } catch {
        r.fichiersEnEchec.push(relatif);
        echec = true;
      }
    }
    r.fichiers += supprimes;
    if (echec) continue;

    const fait = await db.transaction(async (tx) => {
      // Mêmes conditions qu'à la lecture, relues sous verrou : un appel purgé entre-temps, ou dont une analyse vient de
      // repartir, n'est pas touché.
      const [ecrit] = await tx
        .update(appels)
        .set({
          transcription: null,
          audio: null,
          bilan: a.bilan ? purgerBilan(a.bilan) : null,
          erreur: null,
          purgeLe: maintenant,
        })
        .where(and(eq(appels.id, a.id), aPurger(limite), not(enAnalyse(maintenant))))
        .returning({ id: appels.id });
      if (!ecrit) return null;
      const invitations = await tx
        .update(rendezVous)
        .set({ email: null })
        .where(and(eq(rendezVous.appelId, a.id), isNotNull(rendezVous.email)))
        .returning({ id: rendezVous.id });
      return { invitations: invitations.length };
    });
    if (!fait) {
      r.reportes += 1;
      continue;
    }
    r.appels += 1;
    if (a.transcrit) r.transcriptions += 1;
    if (a.bilan) r.bilans += 1;
    if (a.erreur) r.erreurs += 1;
    r.invitations += fait.invitations;
  }

  r.journal = (await db.delete(journalMcp).where(lt(journalMcp.le, limite)).returning({ id: journalMcp.id })).length;
  return r;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Le compte rendu d'une purge ou d'un essai, en une ligne, sans donnée personnelle. */
export function compteRendu(r: InventairePurge | ResultatPurge, essai: boolean): string {
  const jour = r.limite.slice(0, 10);
  const verbe = essai ? 'à purger' : 'purgés';
  const lignes = [
    `${essai ? 'Essai de purge (rien n’est supprimé)' : 'Purge'} : conservation ${r.dureeMois} mois, appels commencés avant le ${jour}.`,
    `${pluriel(r.appels, 'appel', 'appels')} ${verbe} : ${pluriel(r.transcriptions, 'transcription', 'transcriptions')}, ${pluriel(r.bilans, 'bilan', 'bilans')} réduits à leurs champs structurés, ${pluriel(r.erreurs, 'texte d’erreur', 'textes d’erreur')}, ${pluriel(r.invitations, 'adresse d’invitation', 'adresses d’invitation')}, ${pluriel(r.fichiers, 'fichier', 'fichiers')} ${essai ? 'présents sur le disque' : 'supprimés'}.`,
    `${pluriel(r.journal, 'ligne', 'lignes')} du journal MCP ${essai ? 'à supprimer' : 'supprimées'}.`,
    ...(r.reportes ? [`${pluriel(r.reportes, 'appel en cours d’analyse reporté', 'appels en cours d’analyse reportés')} au passage suivant.`] : []),
    ...('fichiersEnEchec' in r && r.fichiersEnEchec.length
      ? [`${pluriel(r.fichiersEnEchec.length, 'fichier n’a', 'fichiers n’ont')} pas pu être supprimés, leurs appels restent entiers : ${r.fichiersEnEchec.join(', ')}.`]
      : []),
  ];
  return lignes.join('\n');
}
