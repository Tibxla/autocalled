import 'server-only';
import { unlink } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { supprimerEvenement } from '@autocalled/agenda';
import type { EntreeCampagne } from '@autocalled/domain';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, campagnes, consentements, entreprises, journalMcp, type Origine, prospects, rendezVous } from '@/db/schema';
import { DUREE_MAX_ANALYSE_S, dossierDonnees } from './appels';
import type { Refus } from './entreprises';
import { numeroLisible } from './format';
import { accesGoogle, clientGoogle, connexion } from './google';
import { OPPOSITION_ILLISIBLE, SEL_ABSENT, inscrireOpposition, numerosOpposes, selOpposition } from './opposition';

/**
 * Effacement d'une personne (droit à l'effacement, ADR 0013) : sa fiche, ses appels avec transcriptions et bilans,
 * les enregistrements sur disque (application et pont), ses rendez-vous et, quand l'API Google le permet, leurs
 * événements, ses entrées de campagne, ses rappels, le consentement de son numéro et ses mentions dans le journal
 * MCP. Seule reste l'empreinte irréversible de son numéro dans la liste d'opposition : il ne sera plus jamais
 * composé ni importé. Irréversible.
 *
 * Les autres prospects qui portent le même numéro (même personne dans une autre entreprise, standard partagé) ne
 * sont pas effacés : ce serait effacer quelqu'un d'autre sur une supposition. Leur fiche reste, mais le numéro étant
 * en opposition, ils ne sont plus appelables ; la confirmation et le résultat les nomment, pour les effacer aussi
 * si c'est la même personne.
 */

/** Ce qui remplace la personne dans le journal MCP. */
export const MENTION_NEUTRE = '[personne effacée]';

/** Un rendez-vous plus jeune que ça, encore « à créer », peut être en train de s'inscrire dans Google Agenda. */
const INSCRIPTION_MAX_S = 5 * 60;

export interface AutrePorteur {
  entreprise: string;
  entrepriseNom: string;
  prospect: string;
  nom: string;
}

export interface EvenementAgenda {
  /** Début du rendez-vous (ISO). */
  debut: string;
  /** Google annulera l'invitation (rendez-vous à venir), ou l'événement est retiré sans prévenir (passé). */
  aVenir: boolean;
  /** L'application peut le supprimer elle-même (API connectée, calendrier qu'elle a créé) ; sinon, à la main. */
  supprimable: boolean;
}

/** Ce qu'un effacement supprimerait, compté dans la base : la confirmation (interface et MCP) le montre tel quel. */
export interface InventaireEffacement {
  prospect: { id: string; nom: string; societe: string | null; numero: string; numeroLisible: string; email: string | null; archive: boolean };
  appels: number;
  transcriptions: number;
  bilans: number;
  enregistrements: number;
  rendezVous: number;
  evenements: EvenementAgenda[];
  /** Entrées de la personne dans les files de campagne (une par campagne où elle figure). */
  entreesCampagne: number;
  /** Un rappel convenu reste à faire. */
  rappel: boolean;
  consentements: number;
  mentionsJournal: number;
  /** Conversations chez ElevenLabs : Autocalled ne les supprime pas (voir le résultat). */
  conversations: number;
  autresPorteurs: AutrePorteur[];
  /** Pourquoi l'effacement serait refusé maintenant, ou null. */
  obstacle: string | null;
}

export interface ResultatEffacement {
  ok: true;
  efface: {
    appels: number;
    transcriptions: number;
    bilans: number;
    rendezVous: number;
    entreesCampagne: number;
    campagnesSupprimees: number;
    campagnesTerminees: number;
    consentements: number;
    mentionsJournal: number;
    fichiers: number;
    evenements: number;
  };
  /** Fichiers qui n'ont pas pu être supprimés (chemins relatifs au dossier de données, sans nom de personne). */
  fichiersEnEchec: string[];
  /** Événements Google à supprimer à la main, avec la raison. */
  evenementsASupprimer: { debut: string; calendrier: string | null; raison: string }[];
  /** Conversations ElevenLabs de ces appels, à supprimer depuis le tableau de bord d'ElevenLabs. */
  conversationsElevenLabs: string[];
  autresPorteurs: AutrePorteur[];
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Lecteur = Pick<typeof db, 'select' | '$count'>;

interface Collecte {
  prospect: typeof prospects.$inferSelect;
  appels: { id: string; statut: string; traitementLe: Date | null; finLe: Date | null; debutLe: Date; audio: string | null; conversationId: string | null; transcrit: boolean; analyse: boolean; ligne: string; issueSysteme: string | null }[];
  rendezVous: { id: string; statut: string; evenementId: string | null; calendrier: string | null; debut: Date; creeLe: Date }[];
  campagnes: { id: string; statut: string; entrees: EntreeCampagne[] }[];
  consentements: number;
  autresPorteurs: AutrePorteur[];
}

/** Tout ce qui se rattache à la personne, lu d'un coup ; `verrouiller` pose les verrous de ligne de l'effacement. */
async function collecter(lecteur: Lecteur | Transaction, entrepriseId: string, prospectId: string, verrouiller: boolean): Promise<Collecte | null> {
  const requeteProspect = lecteur.select().from(prospects).where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  const [prospect] = await (verrouiller ? requeteProspect.for('update') : requeteProspect);
  if (!prospect) return null;
  const requeteAppels = lecteur
    .select({
      id: appels.id,
      statut: appels.statut,
      traitementLe: appels.traitementLe,
      finLe: appels.finLe,
      debutLe: appels.debutLe,
      audio: appels.audio,
      conversationId: appels.conversationId,
      transcrit: sql<boolean>`${appels.transcription} is not null`,
      analyse: sql<boolean>`${appels.bilan} is not null`,
      ligne: appels.ligne,
      issueSysteme: appels.issueSysteme,
    })
    .from(appels)
    .where(and(eq(appels.entrepriseId, entrepriseId), eq(appels.prospectId, prospectId)));
  const lesAppels = await (verrouiller ? requeteAppels.for('update') : requeteAppels);
  const ids = lesAppels.map((a) => a.id);
  const lesRendezVous = ids.length
    ? await lecteur
        .select({ id: rendezVous.id, statut: rendezVous.statut, evenementId: rendezVous.evenementId, calendrier: rendezVous.calendrier, debut: rendezVous.debut, creeLe: rendezVous.creeLe })
        .from(rendezVous)
        .where(inArray(rendezVous.appelId, ids))
    : [];
  const requeteCampagnes = lecteur
    .select({ id: campagnes.id, statut: campagnes.statut, entrees: campagnes.entrees })
    .from(campagnes)
    .where(
      and(
        eq(campagnes.entrepriseId, entrepriseId),
        sql`exists (select 1 from jsonb_array_elements(${campagnes.entrees}) e where e->>'prospectId' = ${prospectId})`,
      ),
    )
    .orderBy(campagnes.id);
  const lesCampagnes = await (verrouiller ? requeteCampagnes.for('update') : requeteCampagnes);
  const [nConsentements, autres] = await Promise.all([
    lecteur.$count(consentements, eq(consentements.numero, prospect.telephone)),
    lecteur
      .select({ entreprise: entreprises.slug, entrepriseNom: entreprises.nom, prospect: prospects.id, nom: prospects.nom })
      .from(prospects)
      .innerJoin(entreprises, eq(entreprises.id, prospects.entrepriseId))
      .where(and(eq(prospects.telephone, prospect.telephone), or(ne(prospects.entrepriseId, entrepriseId), ne(prospects.id, prospectId))))
      .orderBy(entreprises.nom, prospects.nom),
  ]);
  return {
    prospect,
    appels: lesAppels.map((a) => ({ ...a, transcrit: Boolean(a.transcrit), analyse: Boolean(a.analyse) })),
    rendezVous: lesRendezVous,
    campagnes: lesCampagnes,
    consentements: nConsentements,
    autresPorteurs: autres,
  };
}

/** Pourquoi l'effacement ne peut pas se faire maintenant, ou null. */
function obstacle(c: Collecte, maintenant: Date): string | null {
  if (c.appels.some((a) => a.statut === 'en-cours')) return 'Un appel avec cette personne est en cours : attends qu’il finisse, puis efface-la.';
  const analyse = c.appels.find((a) => a.statut === 'traitement' && maintenant.getTime() - (a.traitementLe ?? a.finLe ?? a.debutLe).getTime() < DUREE_MAX_ANALYSE_S * 1000);
  // Le rapatriement écrit l'enregistrement sur disque après avoir relu ElevenLabs : effacer pendant ce temps laisserait
  // un fichier orphelin avec la voix de la personne.
  if (analyse) return 'Le bilan d’un de ses appels est en cours de calcul (enregistrement en cours de rapatriement) : réessaie dans quelques minutes.';
  if (c.campagnes.some((k) => k.entrees.some((e) => e.prospectId === c.prospect.id && e.etat === 'en-appel'))) {
    return 'Cette personne est en appel dans une campagne : attends la fin de l’appel.';
  }
  if (c.rendezVous.some((r) => r.statut === 'a-creer' && maintenant.getTime() - r.creeLe.getTime() < INSCRIPTION_MAX_S * 1000)) {
    return 'Un de ses rendez-vous est en cours d’inscription dans Google Agenda : réessaie dans quelques minutes, pour que l’événement soit supprimé lui aussi.';
  }
  return null;
}

/* ------------------------------------------------------------------ journal MCP */

function echapperRegex(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function echapperLike(texte: string): string {
  return texte.replace(/[\\%_]/g, '\\$&');
}

/**
 * Ce qui désigne la personne dans un texte du journal : son identifiant (tel quel, casse comprise : un prénom
 * ailleurs n'est pas touché), son nom, son adresse, son numéro sous ses formes courantes, et les identifiants de ses
 * appels (effacés). Chaque marque est cherchée comme un mot entier.
 */
export function marquesDeLaPersonne(p: { id: string; nom: string; email: string | null; telephone: string }, appelIds: readonly string[] = []) {
  const national = numeroLisible(p.telephone);
  const marques: { texte: string; casse: boolean }[] = [
    { texte: p.id, casse: true },
    { texte: p.nom.trim(), casse: false },
    { texte: p.telephone, casse: true },
    { texte: national, casse: true },
    { texte: national.replace(/\s/g, ''), casse: true },
    ...(p.email ? [{ texte: p.email.trim(), casse: false }] : []),
    ...appelIds.map((id) => ({ texte: id, casse: false })),
  ].filter((m) => m.texte.length >= 2);
  // Les plus longues d'abord : « Julie Fictive » avant « julie ».
  const uniques = [...new Map(marques.map((m) => [`${m.casse}:${m.texte}`, m])).values()].sort((a, b) => b.texte.length - a.texte.length);
  const expressions = uniques.map((m) => new RegExp(`(?<![\\p{L}\\p{N}_-])${echapperRegex(m.texte)}(?![\\p{L}\\p{N}_-])`, m.casse ? 'gu' : 'giu'));
  return { textes: uniques.map((m) => m.texte), expressions };
}

function neutraliserTexte(texte: string, expressions: readonly RegExp[]): string {
  return expressions.reduce((t, e) => t.replace(e, MENTION_NEUTRE), texte);
}

function neutraliserValeur(valeur: unknown, expressions: readonly RegExp[]): unknown {
  if (typeof valeur === 'string') return neutraliserTexte(valeur, expressions);
  if (Array.isArray(valeur)) return valeur.map((v) => neutraliserValeur(v, expressions));
  if (valeur && typeof valeur === 'object') return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, neutraliserValeur(v, expressions)]));
  return valeur;
}

/** Les lignes du journal MCP qui mentionnent la personne, avec leur version neutralisée. */
async function mentionsDuJournal(lecteur: Lecteur | Transaction, marques: ReturnType<typeof marquesDeLaPersonne>) {
  if (marques.textes.length === 0) return [];
  const candidates = await lecteur
    .select({ id: journalMcp.id, arguments: journalMcp.arguments, message: journalMcp.message })
    .from(journalMcp)
    .where(or(...marques.textes.flatMap((t) => [sql`${journalMcp.arguments}::text ilike ${`%${echapperLike(t)}%`}`, sql`${journalMcp.message} ilike ${`%${echapperLike(t)}%`}`])));
  const touchees: { id: string; arguments: Record<string, unknown>; message: string | null }[] = [];
  for (const l of candidates) {
    const args = neutraliserValeur(l.arguments, marques.expressions) as Record<string, unknown>;
    const message = l.message === null ? null : neutraliserTexte(l.message, marques.expressions);
    if (message !== l.message || JSON.stringify(args) !== JSON.stringify(l.arguments)) touchees.push({ id: l.id, arguments: args, message });
  }
  return touchees;
}

/* ------------------------------------------------------------------ inventaire */

function evenementsDe(c: Collecte, calendrierApp: string | null, maintenant: Date): EvenementAgenda[] {
  return c.rendezVous
    .filter((r) => r.evenementId)
    .map((r) => ({ debut: r.debut.toISOString(), aVenir: r.debut > maintenant, supprimable: calendrierApp !== null && r.calendrier === calendrierApp }));
}

function rappelAFaire(c: Collecte): boolean {
  const dernier = c.appels.filter((a) => a.ligne !== 'simulation').sort((a, b) => b.debutLe.getTime() - a.debutLe.getTime())[0];
  return dernier?.issueSysteme === 'rappel-convenu';
}

/**
 * Ce que l'effacement de ce prospect supprimerait, compté dans la base, et ce qui l'en empêche. Null si le prospect
 * n'existe pas. Lecture seule : ni réseau ni disque (les événements « supprimables » le sont d'après la connexion
 * Google enregistrée).
 */
export async function inventaireEffacement(entrepriseId: string, prospectId: string, maintenant = new Date()): Promise<InventaireEffacement | null> {
  const c = await collecter(db, entrepriseId, prospectId, false);
  if (!c) return null;
  const marques = marquesDeLaPersonne(c.prospect, c.appels.map((a) => a.id));
  const [mentions, google] = await Promise.all([mentionsDuJournal(db, marques), connexion()]);
  const selManquant = selOpposition() ? null : SEL_ABSENT;
  const illisible = selManquant ? null : (await numerosOpposes([c.prospect.telephone])) === 'illisible' ? OPPOSITION_ILLISIBLE : null;
  return {
    prospect: {
      id: c.prospect.id,
      nom: c.prospect.nom,
      societe: c.prospect.societe,
      numero: c.prospect.telephone,
      numeroLisible: numeroLisible(c.prospect.telephone),
      email: c.prospect.email,
      archive: c.prospect.archiveLe !== null,
    },
    appels: c.appels.length,
    transcriptions: c.appels.filter((a) => a.transcrit).length,
    bilans: c.appels.filter((a) => a.analyse).length,
    enregistrements: c.appels.filter((a) => a.audio || a.ligne === 'bluetooth').length,
    rendezVous: c.rendezVous.length,
    evenements: evenementsDe(c, clientGoogle() && google ? google.calendrierId : null, maintenant),
    entreesCampagne: c.campagnes.length,
    rappel: rappelAFaire(c),
    consentements: c.consentements,
    mentionsJournal: mentions.length,
    conversations: c.appels.filter((a) => a.conversationId).length,
    autresPorteurs: c.autresPorteurs,
    obstacle: selManquant ?? illisible ?? obstacle(c, maintenant),
  };
}

/* ------------------------------------------------------------------ effacement */

/** Supprime un fichier du dossier de données ; faux s'il n'existait pas. Refuse un chemin qui en sortirait. */
async function supprimerFichier(relatif: string): Promise<boolean> {
  const racine = normalize(dossierDonnees());
  const chemin = normalize(join(racine, relatif));
  if (!chemin.startsWith(racine + sep)) throw new Error('chemin hors du dossier de données');
  try {
    await unlink(chemin);
    return true;
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw erreur;
  }
}

/**
 * Efface la personne que porte ce prospect (voir l'en-tête du module). Refusé sans sel d'opposition, pendant un
 * appel avec elle, pendant le rapatriement d'un de ses enregistrements ou l'inscription d'un de ses rendez-vous.
 * La base est effacée d'un bloc (transaction) ; les fichiers et les événements Google ensuite, chaque échec rendu
 * dans le résultat pour être fini à la main.
 */
export async function effacerPersonne(entrepriseId: string, prospectId: string, par: Origine, maintenant = new Date()): Promise<ResultatEffacement | Refus> {
  const sel = selOpposition();
  if (!sel) return { ok: false, raison: SEL_ABSENT };

  const fait = await db.transaction(async (tx) => {
    const c = await collecter(tx, entrepriseId, prospectId, true);
    if (!c) return { ok: false as const, raison: 'Ce prospect n’existe pas dans cette entreprise (déjà effacé ?).' };
    if ((await numerosOpposes([c.prospect.telephone], tx)) === 'illisible') return { ok: false as const, raison: OPPOSITION_ILLISIBLE };
    const refus = obstacle(c, maintenant);
    if (refus) return { ok: false as const, raison: refus };

    // Files de campagne : ses entrées partent ; une campagne vidée est supprimée, une campagne qui n'a plus
    // personne à appeler est terminée.
    let campagnesSupprimees = 0;
    let campagnesTerminees = 0;
    for (const k of c.campagnes) {
      const reste = k.entrees.filter((e) => e.prospectId !== prospectId);
      if (reste.length === 0) {
        await tx.delete(campagnes).where(eq(campagnes.id, k.id));
        campagnesSupprimees += 1;
        continue;
      }
      const statut = k.statut !== 'terminee' && !reste.some((e) => e.etat === 'a-appeler' || e.etat === 'en-appel') ? 'terminee' : k.statut;
      if (statut !== k.statut) campagnesTerminees += 1;
      await tx
        .update(campagnes)
        .set({ entrees: reste, statut: statut as typeof campagnes.$inferInsert.statut })
        .where(eq(campagnes.id, k.id));
    }

    const appelIds = c.appels.map((a) => a.id);
    // Les rendez-vous partent avec leurs appels (cascade) ; comptés avant.
    if (appelIds.length) await tx.delete(appels).where(inArray(appels.id, appelIds));
    await tx.delete(prospects).where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
    const nConsentements = (await tx.delete(consentements).where(eq(consentements.numero, c.prospect.telephone)).returning({ id: consentements.id })).length;

    const mentions = await mentionsDuJournal(tx, marquesDeLaPersonne(c.prospect, appelIds));
    for (const m of mentions) await tx.update(journalMcp).set({ arguments: m.arguments, message: m.message }).where(eq(journalMcp.id, m.id));

    const efface = {
      appels: c.appels.length,
      transcriptions: c.appels.filter((a) => a.transcrit).length,
      bilans: c.appels.filter((a) => a.analyse).length,
      rendezVous: c.rendezVous.length,
      entreesCampagne: c.campagnes.length,
      campagnesSupprimees,
      campagnesTerminees,
      consentements: nConsentements,
      mentionsJournal: mentions.length,
    };
    await inscrireOpposition(tx, c.prospect.telephone, sel, par, efface);
    return { ok: true as const, c, efface };
  });
  if (!fait.ok) return fait;
  const { c, efface } = fait;

  // Disque : l'enregistrement rapatrié par l'application, et ceux du pont (son stéréo et journal de l'appel).
  let fichiers = 0;
  const fichiersEnEchec: string[] = [];
  for (const a of c.appels) {
    const chemins = [...(a.audio ? [a.audio] : []), join('pont', `${a.id}.wav`), join('pont', `${a.id}.log`)];
    for (const relatif of chemins) {
      try {
        if (await supprimerFichier(relatif)) fichiers += 1;
      } catch {
        fichiersEnEchec.push(relatif);
      }
    }
  }

  // Google Agenda : l'application ne supprime que dans le calendrier qu'elle a créé, par l'API.
  let evenements = 0;
  const evenementsASupprimer: ResultatEffacement['evenementsASupprimer'] = [];
  const aSupprimer = c.rendezVous.filter((r) => r.evenementId);
  const google = aSupprimer.length ? await accesGoogle().catch(() => null) : null;
  for (const r of aSupprimer) {
    const reste = (raison: string) => evenementsASupprimer.push({ debut: r.debut.toISOString(), calendrier: r.calendrier, raison });
    if (!google) {
      reste('API Google Agenda non connectée : supprime l’événement dans Google Agenda.');
    } else if (r.calendrier !== google.calendrierId) {
      reste('Événement créé dans un autre calendrier que celui d’Autocalled : supprime-le dans Google Agenda.');
    } else {
      try {
        await supprimerEvenement(google.acces, r.calendrier, r.evenementId as string, r.debut > maintenant);
        evenements += 1;
      } catch {
        reste('Google Agenda a refusé la suppression : supprime l’événement à la main.');
      }
    }
  }

  return {
    ok: true,
    efface: { ...efface, fichiers, evenements },
    fichiersEnEchec,
    evenementsASupprimer,
    conversationsElevenLabs: c.appels.flatMap((a) => (a.conversationId ? [a.conversationId] : [])),
    autresPorteurs: c.autresPorteurs,
  };
}

/* ------------------------------------------------------------------ texte de la confirmation */

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Ce que dit la confirmation d'un effacement, en phrases, d'après l'inventaire : ce qui sera effacé, puis ce qui
 * reste et ce qu'il faudra finir à la main. Une seule rédaction pour l'interface et le serveur MCP. `champ` met en
 * forme les noms venus de la base (le MCP les coupe et les nettoie) ; l'interface garde le numéro d'un seul tenant.
 */
export function phrasesEffacement(
  inv: InventaireEffacement,
  champ: (texte: string) => string = (t) => t,
  o: { numeroInsecable?: boolean } = {},
): { efface: string[]; reste: string[] } {
  // À l'écran, le numéro ne se coupe pas en fin de ligne.
  const numero = o.numeroInsecable ? inv.prospect.numeroLisible.replace(/ /g, '\u00a0') : inv.prospect.numeroLisible;
  const efface = [
    `sa fiche (${champ(`${inv.prospect.id}.md`)} : nom, société, rôle, e-mail, contexte)`,
    inv.appels
      ? `${pluriel(inv.appels, 'appel', 'appels')}, avec ${pluriel(inv.transcriptions, 'transcription', 'transcriptions')} et ${pluriel(inv.bilans, 'bilan', 'bilans')}${inv.rappel ? ', dont le rappel convenu à faire' : ''}`
      : 'aucun appel',
    ...(inv.enregistrements ? [`les enregistrements de ${pluriel(inv.enregistrements, 'appel', 'appels')} sur le disque (application et pont)`] : []),
    ...(inv.rendezVous
      ? [
          `${pluriel(inv.rendezVous, 'rendez-vous', 'rendez-vous')}${
            inv.evenements.some((e) => e.supprimable)
              ? `, et leur événement dans Google Agenda${inv.evenements.some((e) => e.supprimable && e.aVenir) ? ' (Google envoie l’annulation pour ceux à venir)' : ''}`
              : ''
          }`,
        ]
      : []),
    ...(inv.entreesCampagne
      ? [`sa place dans ${pluriel(inv.entreesCampagne, 'file de campagne', 'files de campagne')} (une campagne qui ne contenait qu’elle est supprimée ; les comptes des autres changent)`]
      : []),
    ...(inv.consentements ? [`le consentement de son numéro (${pluriel(inv.consentements, 'accord enregistré', 'accords enregistrés')})`] : []),
    ...(inv.mentionsJournal ? [`${pluriel(inv.mentionsJournal, 'mention', 'mentions')} dans le journal de Claude Code, remplacées par « ${MENTION_NEUTRE} »`] : []),
  ];
  const aLaMain = inv.evenements.filter((e) => !e.supprimable).length;
  const reste = [
    `Seule reste l’empreinte irréversible du numéro ${numero} dans la liste d’opposition : il ne sera plus jamais appelé ni importé.`,
    ...(inv.autresPorteurs.length
      ? [
          `Ce numéro est aussi celui de ${inv.autresPorteurs.map((a) => `${champ(a.nom)} (${champ(a.entrepriseNom)})`).join(', ')} : ${
            inv.autresPorteurs.length > 1 ? 'leurs fiches restent, mais ces prospects ne seront plus appelables' : 'sa fiche reste, mais ce prospect ne sera plus appelable'
          }. Si c’est la même personne, efface ${inv.autresPorteurs.length > 1 ? 'ces fiches' : 'cette fiche'} aussi.`,
        ]
      : []),
    ...(aLaMain ? [`${pluriel(aLaMain, 'événement', 'événements')} d’agenda à supprimer à la main dans Google Agenda (l’application n’y a pas accès).`] : []),
    ...(inv.conversations
      ? [`${pluriel(inv.conversations, 'conversation reste', 'conversations restent')} chez ElevenLabs : à supprimer depuis leur tableau de bord (identifiants rendus après l’effacement).`]
      : []),
    'Irréversible : rien de tout cela ne pourra être retrouvé.',
  ];
  return { efface, reste };
}

/* ------------------------------------------------------------------ rapport pour l'interface */

/**
 * Ce que l'interface montre après un effacement : des comptes et ce qui reste à finir à la main, sans nom ni numéro.
 * Depuis la fiche, il voyage dans l'adresse de la liste (la fiche n'existe plus) : rien de personnel n'y entre.
 */
export interface RapportEffacement {
  efface: ResultatEffacement['efface'];
  fichiersEnEchec: string[];
  evenementsASupprimer: { debut: string }[];
  conversationsElevenLabs: string[];
  autresPorteurs: { entreprise: string; prospect: string }[];
}

export function rapportEffacement(r: ResultatEffacement): RapportEffacement {
  return {
    efface: r.efface,
    fichiersEnEchec: r.fichiersEnEchec,
    evenementsASupprimer: r.evenementsASupprimer.map((e) => ({ debut: e.debut })),
    conversationsElevenLabs: r.conversationsElevenLabs,
    autresPorteurs: r.autresPorteurs.map((a) => ({ entreprise: a.entreprise, prospect: a.prospect })),
  };
}

const schemaRapport = z.object({
  efface: z.record(z.string(), z.number().int().min(0).max(1_000_000)),
  fichiersEnEchec: z.array(z.string().max(200)).max(1000),
  evenementsASupprimer: z.array(z.object({ debut: z.iso.datetime() })).max(1000),
  conversationsElevenLabs: z.array(z.string().max(200)).max(1000),
  autresPorteurs: z.array(z.object({ entreprise: z.string().max(200), prospect: z.string().max(200) })).max(1000),
});

export const encoderRapport = (r: RapportEffacement) => Buffer.from(JSON.stringify(r)).toString('base64url');

/** Le rapport relu depuis l'adresse, ou null s'il est illisible (adresse retouchée, tronquée). */
export function decoderRapport(brut: string): RapportEffacement | null {
  try {
    const lu = schemaRapport.safeParse(JSON.parse(Buffer.from(brut, 'base64url').toString('utf8')));
    return lu.success ? (lu.data as RapportEffacement) : null;
  } catch {
    return null;
  }
}
