import 'server-only';
import { creerEvenement, creneauParle, listerCalendriers, occupations as occupationsApi } from '@autocalled/agenda';
import { type Intervalle, type PlageHoraire, type ReglesRendezVous, estReservable, occupationsDepuisLibres, proposerCreneaux } from '@autocalled/domain';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { appels, disponibilites, entreprises, prospects, rendezVous } from '@/db/schema';
import { claudeStructure } from './claude';
import { accesGoogle } from './google';

/**
 * L'agenda de l'opérateur, vu par Mina. Deux sources : l'API Google si un client OAuth est connecté,
 * sinon le connecteur Google Agenda de Claude (MCP), lu par `claude -p`. Le MCP est lent (une
 * vingtaine de secondes) : on garde une copie des plages occupées, relue avant les appels, et
 * l'événement d'un rendez-vous est créé juste après sa réservation, en tâche de fond.
 */

const FRAICHEUR_MINUTES = 10;
const HORIZON_MAX_JOURS = 21;
const OUTILS_LECTURE = ['mcp__claude_ai_Google_Calendar__list_calendars', 'mcp__claude_ai_Google_Calendar__suggest_time'];
const OUTILS_ECRITURE = ['mcp__claude_ai_Google_Calendar__list_calendars', 'mcp__claude_ai_Google_Calendar__create_event'];

const iso = (d: Date) => d.toISOString();

async function lireParMcp(debut: Date, fin: Date): Promise<Intervalle[]> {
  const r = (await claudeStructure({
    modele: 'haiku',
    outilsMcp: OUTILS_LECTURE,
    delaiMs: 120_000,
    schema: {
      type: 'object',
      properties: {
        libres: {
          type: 'array',
          items: { type: 'object', properties: { debut: { type: 'string' }, fin: { type: 'string' } }, required: ['debut', 'fin'], additionalProperties: false },
        },
      },
      required: ['libres'],
      additionalProperties: false,
    },
    prompt: `Appelle list_calendars, puis appelle UNE seule fois suggest_time avec tous les identifiants de calendriers en attendeeEmails, startTime ${iso(debut)}, endTime ${iso(fin)}, durationMinutes 15, timeZone Europe/Paris, preferences { startHour 07:00, endHour 22:00, pageSize 250 }. Recopie chaque plage libre renvoyée (startTime, endTime) sans rien modifier.`,
  })) as { libres: { debut: string; fin: string }[] };
  const libres = r.libres.map((l) => ({ debut: new Date(l.debut), fin: new Date(l.fin) })).filter((l) => !Number.isNaN(l.debut.getTime()));
  return occupationsDepuisLibres(libres, { debut, fin });
}

async function lireParApi(acces: string, debut: Date, fin: Date): Promise<Intervalle[]> {
  return occupationsApi(acces, (await listerCalendriers(acces)).map((c) => c.id), debut, fin);
}

let enCours: Promise<void> | null = null;

/** Relit l'agenda et remplace la copie des plages occupées. En cas d'échec, l'ancienne copie reste. */
export function synchroniserAgenda(): Promise<void> {
  enCours ??= (async () => {
    const debut = new Date();
    const fin = new Date(debut.getTime() + HORIZON_MAX_JOURS * 86_400_000);
    const google = await accesGoogle().catch(() => null);
    try {
      const occupees = google ? await lireParApi(google.acces, debut, fin) : await lireParMcp(debut, fin);
      const valeurs = {
        id: 1,
        source: google ? ('api' as const) : ('mcp' as const),
        occupations: occupees.map((o) => ({ debut: iso(o.debut), fin: iso(o.fin) })),
        fenetreDebut: debut,
        fenetreFin: fin,
        synchroniseLe: new Date(),
        erreur: null,
      };
      await db.insert(disponibilites).values(valeurs).onConflictDoUpdate({ target: disponibilites.id, set: valeurs });
    } catch (erreur) {
      await db.update(disponibilites).set({ erreur: (erreur as Error).message }).where(eq(disponibilites.id, 1));
    }
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}

export async function etatAgenda() {
  const [ligne] = await db.select().from(disponibilites).limit(1);
  return ligne ?? null;
}

/** Relance une lecture en tâche de fond si la copie a plus de dix minutes. À appeler au début d'un appel. */
export async function rafraichirSiAncien(): Promise<void> {
  const etat = await etatAgenda();
  if (!etat || Date.now() - etat.synchroniseLe.getTime() > FRAICHEUR_MINUTES * 60_000) after(() => synchroniserAgenda());
}

/** Plages occupées : la copie de l'agenda, plus les rendez-vous déjà pris par Mina et pas encore relus. */
async function occupations(): Promise<{ occupees: Intervalle[]; fenetreFin: Date } | null> {
  let etat = await etatAgenda();
  if (!etat) {
    await synchroniserAgenda();
    etat = await etatAgenda();
  }
  if (!etat?.occupations) return null;
  // Un rendez-vous dont l'événement Google a échoué reste pris : le prospect, lui, l'a noté.
  const nosRendezVous = await db.select({ debut: rendezVous.debut, fin: rendezVous.fin }).from(rendezVous);
  return {
    occupees: [...etat.occupations.map((o) => ({ debut: new Date(o.debut), fin: new Date(o.fin) })), ...nosRendezVous],
    // Au-delà de la fenêtre relue, on ne sait rien : c'est occupé.
    fenetreFin: etat.fenetreFin,
  };
}

async function contexteAppel(appelId: string) {
  const [ligne] = await db
    .select({ appel: appels, entreprise: entreprises, prospect: prospects })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .innerJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .where(eq(appels.id, appelId));
  if (!ligne) return null;
  const regles: ReglesRendezVous = {
    dureeMinutes: ligne.entreprise.dureeRendezVousMinutes,
    plages: ligne.entreprise.plagesRendezVous as PlageHoraire[],
    delaiMinimumHeures: ligne.entreprise.delaiMinimumHeures,
    horizonJours: ligne.entreprise.horizonJours,
    fuseau: ligne.entreprise.fuseau,
  };
  return { ...ligne, regles };
}

const INDISPONIBLE = "L'agenda n'est pas disponible. Demande au prospect le jour et le moment qui l'arrangent, et dis-lui qu'on lui confirme le créneau.";

function borner(regles: ReglesRendezVous, fenetreFin: Date, maintenant: Date): ReglesRendezVous {
  const joursConnus = Math.floor((fenetreFin.getTime() - maintenant.getTime()) / 86_400_000);
  return { ...regles, horizonJours: Math.max(0, Math.min(regles.horizonJours, joursConnus)) };
}

export async function proposerPourAppel(appelId: string): Promise<unknown> {
  const c = await contexteAppel(appelId);
  if (!c) return "Appel inconnu : propose au prospect qu'on le recontacte pour fixer un moment.";
  const occ = await occupations();
  if (!occ) return INDISPONIBLE;
  const maintenant = new Date();
  const creneaux = proposerCreneaux(borner(c.regles, occ.fenetreFin, maintenant), occ.occupees, maintenant);
  if (creneaux.length === 0) return "Aucun créneau libre dans les prochains jours : propose qu'on le rappelle pour convenir d'un moment.";
  return {
    consigne: 'Propose ces créneaux à l’oral, un ou deux à la fois. Pour réserver, passe la valeur debut exacte à reserver_creneau.',
    creneaux: creneaux.map((x) => ({ debut: iso(x.debut), libelle: creneauParle(x.debut, c.regles.fuseau) })),
  };
}

export async function reserverPourAppel(appelId: string, debutBrut: unknown): Promise<unknown> {
  const c = await contexteAppel(appelId);
  if (!c) return { reserve: false, raison: 'Appel inconnu.' };
  const [deja] = await db.select().from(rendezVous).where(eq(rendezVous.appelId, appelId));
  if (deja) return { reserve: true, libelle: creneauParle(deja.debut, c.regles.fuseau), note: 'Déjà réservé pendant cet appel.' };

  const debut = new Date(String(debutBrut ?? ''));
  if (Number.isNaN(debut.getTime())) return { reserve: false, raison: 'Créneau illisible : utilise la valeur debut renvoyée par proposer_creneaux.' };
  const fin = new Date(debut.getTime() + c.regles.dureeMinutes * 60_000);
  const occ = await occupations();
  if (!occ) return { reserve: false, raison: INDISPONIBLE };
  const maintenant = new Date();
  const regles = borner(c.regles, occ.fenetreFin, maintenant);
  if (!estReservable({ debut, fin }, regles, occ.occupees, maintenant)) {
    const alternatives = proposerCreneaux(regles, occ.occupees, maintenant).map((x) => ({ debut: iso(x.debut), libelle: creneauParle(x.debut, c.regles.fuseau) }));
    return { reserve: false, raison: "Ce créneau vient d'être pris ou n'est pas autorisé.", alternatives };
  }

  const [rdv] = await db.insert(rendezVous).values({ appelId, debut, fin }).returning({ id: rendezVous.id });
  if (rdv) after(() => creerEvenementDuRendezVous(rdv.id));
  return { reserve: true, libelle: creneauParle(debut, c.regles.fuseau) };
}

/** Crée l'événement Google d'un rendez-vous déjà réservé : par l'API si elle est connectée, sinon par le MCP. */
export async function creerEvenementDuRendezVous(rendezVousId: string): Promise<void> {
  const [rdv] = await db.select().from(rendezVous).where(eq(rendezVous.id, rendezVousId));
  if (!rdv || rdv.statut === 'cree') return;
  const c = await contexteAppel(rdv.appelId);
  if (!c) return;
  const p = c.prospect;
  const titre = `Premier échange · ${p.nom}${p.societe ? ` (${p.societe})` : ''} · ${c.entreprise.nom}`;
  const description = [
    `${p.nom}${p.role ? `, ${p.role}` : ''}${p.societe ? ` chez ${p.societe}` : ''}`,
    `Téléphone : ${p.telephone}`,
    '',
    p.contexte,
    '',
    `Appel : ${process.env.ORIGINE_APP ?? ''}/appels/${rdv.appelId}`,
  ].join('\n');

  try {
    const google = await accesGoogle().catch(() => null);
    let evenementId: string;
    let calendrier: string;
    if (google) {
      calendrier = google.calendrierId;
      evenementId = await creerEvenement(google.acces, google.calendrierId, { debut: rdv.debut, fin: rdv.fin, titre, description });
    } else {
      const r = (await claudeStructure({
        modele: 'haiku',
        outilsMcp: OUTILS_ECRITURE,
        delaiMs: 120_000,
        schema: {
          type: 'object',
          properties: { evenementId: { type: 'string' }, calendrier: { type: 'string' } },
          required: ['evenementId', 'calendrier'],
          additionalProperties: false,
        },
        prompt: `Appelle list_calendars. Si un calendrier a pour nom (summary) exactement « Autocalled », utilise son identifiant comme calendarId ; sinon, utilise calendarId = primary, littéralement, sans choisir un autre calendrier. Appelle create_event une seule fois avec ce calendarId et exactement ces valeurs, sans rien reformuler :
summary : ${JSON.stringify(titre)}
startTime : ${iso(rdv.debut)}
endTime : ${iso(rdv.fin)}
timeZone : Europe/Paris
description : ${JSON.stringify(description)}
availability : AVAILABILITY_BUSY
notificationLevel : NONE
Renvoie l'identifiant de l'événement créé et le calendarId utilisé.`,
      })) as { evenementId: string; calendrier: string };
      evenementId = r.evenementId;
      calendrier = r.calendrier;
    }
    await db.update(rendezVous).set({ evenementId, calendrier, statut: 'cree', erreur: null }).where(eq(rendezVous.id, rendezVousId));
  } catch (erreur) {
    await db.update(rendezVous).set({ statut: 'echec', erreur: (erreur as Error).message }).where(eq(rendezVous.id, rendezVousId));
  }
}
