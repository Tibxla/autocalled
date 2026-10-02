import 'server-only';
import {
  type Campagne,
  ecrireFiche,
  type FicheProspect,
  type FichierImporte,
  type NumeroE164,
  fusionnerFiches,
  lireFiches,
  retirer,
} from '@autocalled/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes, imports, type Origine, prospects, scripts, versionsScript } from '@/db/schema';
import type { Conflit, Refus } from './entreprises';
import { OPPOSITION_ILLISIBLE, numerosOpposes } from './opposition';
import type { PatchFiche } from './schemas';

export const FICHIERS_MAX = 100;
export const TAILLE_MAX = 32 * 1024;

export type RapportImport =
  | { etat: 'vide' }
  | { etat: 'erreur'; message: string }
  | {
      etat: 'fait';
      crees: string[];
      misAJour: string[];
      inchanges: string[];
      refus: { nomFichier: string; erreurs: string[] }[];
      /** Prospects importés qui restent archivés : un réimport ne les réactive pas. */
      archives: string[];
    };

/** Levée par `importerFiches` quand la fiche attendue a changé (ou disparu) avant son écriture, sous verrou. */
export class FicheChangee extends Error {
  // Pas de propriété de paramètre : le serveur MCP tourne sous Node, qui efface les types sans rien transformer.
  readonly majLe: Date | null;
  constructor(majLe: Date | null) {
    super('fiche changée depuis la lecture');
    this.majLe = majLe;
  }
}

/** Le refus d'une fiche dont le numéro est dans la liste d'opposition (ADR 0013). */
export const NUMERO_EFFACE = 'numéro d’une personne effacée à sa demande : il ne peut plus être importé ni appelé';

/**
 * Importe des fiches prospect Markdown dans une entreprise : leurs numéros sont appelables aussitôt (ADR 0001).
 * Une fiche dont le numéro est dans la liste d'opposition
 * (personne effacée, ADR 0013) est refusée : rien d'elle n'est écrit.
 */
export async function importerFiches(
  entrepriseId: string,
  fichiers: readonly FichierImporte[],
  o: { attendu?: { prospectId: string; majLe: Date } } = {},
): Promise<RapportImport> {
  if (fichiers.length > FICHIERS_MAX) return { etat: 'erreur', message: `${FICHIERS_MAX} fichiers au plus par import.` };
  const trop = fichiers.find((f) => Buffer.byteLength(f.contenu) > TAILLE_MAX);
  if (trop) return { etat: 'erreur', message: `« ${trop.nomFichier} » dépasse 32 Ko : une fiche tient en quelques paragraphes.` };

  const brute = lireFiches(fichiers);
  const opposes = await numerosOpposes(brute.fiches.map((f) => f.telephone));
  if (opposes === 'illisible') return { etat: 'erreur', message: OPPOSITION_ILLISIBLE };
  const lecture = {
    fiches: brute.fiches.filter((f) => !opposes.has(f.telephone)),
    refus: [...brute.refus, ...brute.fiches.filter((f) => opposes.has(f.telephone)).map((f) => ({ nomFichier: `${f.id}.md`, erreurs: [NUMERO_EFFACE] }))],
  };
  if (lecture.fiches.length === 0) {
    return { etat: 'fait', crees: [], misAJour: [], inchanges: [], refus: lecture.refus, archives: [] };
  }

  const existantes: (FicheProspect & { archiveLe: Date | null })[] = (
    await db.select().from(prospects).where(eq(prospects.entrepriseId, entrepriseId))
  ).map((p) => ({ ...p, telephone: p.telephone as NumeroE164 }));
  const fusion = fusionnerFiches(existantes, lecture.fiches);

  await db.transaction(async (tx) => {
    if (o.attendu) {
      // Correction d'une fiche : la ligne est relue sous verrou, et la comparaison refaite ici (FicheChangee).
      const { prospectId, majLe } = o.attendu;
      const [ligne] = await tx
        .select({ majLe: prospects.majLe })
        .from(prospects)
        .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)))
        .for('update');
      if (!ligne || ligne.majLe.getTime() !== majLe.getTime()) throw new FicheChangee(ligne?.majLe ?? null);
    }
    const [imp] = await tx
      .insert(imports)
      .values({ entrepriseId, nombreFiches: lecture.fiches.length })
      .returning({ id: imports.id });
    if (!imp) throw new Error('import impossible');

    for (const fiche of [...fusion.crees, ...fusion.misAJour]) {
      const valeurs = { ...fiche, entrepriseId, importId: imp.id, majLe: new Date() };
      await tx.insert(prospects).values(valeurs).onConflictDoUpdate({ target: [prospects.entrepriseId, prospects.id], set: valeurs });
    }
  });

  const importes = new Set(lecture.fiches.map((f) => f.id));
  return {
    etat: 'fait',
    crees: fusion.crees.map((f) => f.id),
    misAJour: fusion.misAJour.map((f) => f.id),
    inchanges: fusion.inchanges,
    refus: lecture.refus,
    archives: existantes.filter((p) => p.archiveLe && importes.has(p.id)).map((p) => p.id),
  };
}

/**
 * Corrige la fiche d'un prospect par la machinerie de l'import d'une seule fiche : mêmes contrôles (numéro
 * normalisé, adresse, contexte, liste d'opposition), une ligne `imports`. Refusé si la fiche a changé depuis `connu`
 * (son `majLe` lu, en ISO). L'identifiant ne change jamais.
 */
export async function modifierProspect(
  entrepriseId: string,
  prospectId: string,
  champs: PatchFiche,
  o: { connu?: string | null } = {},
): Promise<{ ok: true; rapport: Extract<RapportImport, { etat: 'fait' }> } | Refus | Conflit> {
  const [actuel] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  if (!actuel) return { ok: false, raison: 'Ce prospect n’existe pas dans cette entreprise.' };
  if (o.connu != null && Date.parse(o.connu) !== actuel.majLe.getTime()) {
    return { ok: false, raison: FICHE_CHANGEE, conflit: { le: actuel.majLe, origine: null, jeton: actuel.majLe.toISOString() } };
  }
  const corrige = (patch: string | null | undefined, avant: string | null) => (patch === undefined ? avant : patch?.trim() || null);
  const fiche = {
    id: actuel.id,
    nom: champs.nom?.trim() ?? actuel.nom,
    societe: corrige(champs.societe, actuel.societe),
    role: corrige(champs.role, actuel.role),
    telephone: (champs.telephone?.trim() ?? actuel.telephone) as NumeroE164,
    email: corrige(champs.email, actuel.email),
    contexte: champs.contexte === undefined ? actuel.contexte : champs.contexte.trim(),
  };
  const inchangee = (['nom', 'societe', 'role', 'telephone', 'email', 'contexte'] as const).every((c) => fiche[c] === actuel[c]);
  if (inchangee) return { ok: false, raison: 'Ces champs ne changent rien à la fiche.' };
  let rapport: RapportImport;
  try {
    // La comparaison ci-dessus sert à répondre vite ; celle-ci, sous verrou dans la transaction de l'import, ferme la
    // fenêtre entre la lecture et l'écriture (un réimport arrivé entre les deux n'est pas écrasé).
    rapport = await importerFiches(entrepriseId, [ecrireFiche(fiche)], { attendu: { prospectId, majLe: actuel.majLe } });
  } catch (erreur) {
    if (!(erreur instanceof FicheChangee)) throw erreur;
    return erreur.majLe
      ? { ok: false, raison: FICHE_CHANGEE, conflit: { le: erreur.majLe, origine: null, jeton: erreur.majLe.toISOString() } }
      : { ok: false, raison: 'Ce prospect n’existe plus dans cette entreprise.' };
  }
  if (rapport.etat === 'erreur') return { ok: false, raison: rapport.message };
  if (rapport.etat === 'vide') return { ok: false, raison: 'Rien à enregistrer.' };
  const refus = rapport.refus[0];
  if (refus) return { ok: false, raison: `Fiche refusée, rien n’est écrit : ${refus.erreurs.join(' ; ')}.` };
  return { ok: true, rapport };
}

const FICHE_CHANGEE = 'La fiche a changé depuis ta lecture (import ou autre correction) : relis-la avant de la corriger.';

/** Une campagne non terminée dans la file de laquelle un prospect attend encore d'être appelé. */
export interface FileEnAttente {
  id: string;
  /** « Campagne du 29/09 · Accroche courte v3, en cours » : de quoi la reconnaître sans son identifiant. */
  libelle: string;
  /** Il y est le dernier à appeler : l'en retirer la termine. */
  derniere: boolean;
}

const STATUT_CAMPAGNE: Record<string, string> = { prete: 'prête', 'en-cours': 'en cours', 'en-pause': 'suspendue' };
const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

/** Le libellé d'une campagne dans une confirmation (interface et Claude Code). */
export function libelleCampagne(c: { creeLe: Date; script: string | null; numero: number | null; statut: string }): string {
  const version = c.script ? ` · ${c.script}${c.numero !== null ? ` v${c.numero}` : ''}` : '';
  return `Campagne du ${JOUR_MOIS.format(c.creeLe)}${version}, ${STATUT_CAMPAGNE[c.statut] ?? c.statut}`;
}

type Lecteur = Pick<typeof db, 'select'>;

/**
 * Les campagnes non terminées de l'entreprise dont la file attend encore ce prospect (à appeler), dans l'ordre de
 * leur identifiant : ce qu'un archivage retirerait. Lu par la fiche, la liste des prospects et Claude Code pour
 * nommer ces campagnes dans la confirmation, puis relu sous verrou par `archiverProspect`.
 */
export async function filesEnAttente(entrepriseId: string, prospectId: string, lecteur: Lecteur = db): Promise<FileEnAttente[]> {
  const lignes = await lecteur
    .select({ id: campagnes.id, creeLe: campagnes.creeLe, statut: campagnes.statut, entrees: campagnes.entrees, script: scripts.nom, numero: versionsScript.numero })
    .from(campagnes)
    .leftJoin(versionsScript, eq(versionsScript.id, campagnes.versionScriptId))
    .leftJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(
      and(
        eq(campagnes.entrepriseId, entrepriseId),
        ne(campagnes.statut, 'terminee'),
        sql`exists (select 1 from jsonb_array_elements(${campagnes.entrees}) e where e->>'prospectId' = ${prospectId} and e->>'etat' = 'a-appeler')`,
      ),
    )
    .orderBy(campagnes.id);
  return lignes.map((c) => ({
    id: c.id,
    libelle: libelleCampagne(c),
    derniere: !c.entrees.some((e) => e.prospectId !== prospectId && (e.etat === 'a-appeler' || e.etat === 'en-appel')),
  }));
}

/** Les files d'attente de plusieurs prospects d'une entreprise, en une lecture : pour la liste des prospects. */
export async function filesEnAttenteDesProspects(entrepriseId: string): Promise<Map<string, FileEnAttente[]>> {
  const lignes = await db
    .select({ id: campagnes.id, creeLe: campagnes.creeLe, statut: campagnes.statut, entrees: campagnes.entrees, script: scripts.nom, numero: versionsScript.numero })
    .from(campagnes)
    .leftJoin(versionsScript, eq(versionsScript.id, campagnes.versionScriptId))
    .leftJoin(scripts, eq(scripts.id, versionsScript.scriptId))
    .where(and(eq(campagnes.entrepriseId, entrepriseId), ne(campagnes.statut, 'terminee')))
    .orderBy(campagnes.id);
  const parProspect = new Map<string, FileEnAttente[]>();
  for (const c of lignes) {
    const restants = c.entrees.filter((e) => e.etat === 'a-appeler' || e.etat === 'en-appel');
    for (const e of c.entrees) {
      if (e.etat !== 'a-appeler') continue;
      const file = { id: c.id, libelle: libelleCampagne(c), derniere: restants.every((r) => r.prospectId === e.prospectId) };
      parProspect.set(e.prospectId, [...(parProspect.get(e.prospectId) ?? []), file]);
    }
  }
  return parProspect;
}

/** Les campagnes lues en plus de celles confirmées, nommées pour le refus. */
function filesNonConfirmees(files: readonly FileEnAttente[], confirmees: readonly string[]): FileEnAttente[] {
  return files.filter((f) => !confirmees.includes(f.id));
}

/**
 * Archive un prospect (ADR 0013) : il sort des listes par défaut et des choix de campagne, et ne peut plus être
 * appelé ni ajouté à une campagne tant qu'il l'est. Ses appels et ses bilans restent.
 * Réversible, donc sans confirmation, sauf s'il attend dans la file d'une campagne non terminée : il en est alors
 * retiré (motif « retrait », trace gardée) sous le verrou de la campagne, pour qu'aucun enchaînement ne le compose ni
 * ne le saute entre-temps, et ce retrait ne se défait pas (le réactiver ne l'y remet pas) : il est
 * confirmé. `filesConfirmees` : les campagnes nommées dans cette confirmation (vide sans confirmation). Une file où il
 * attend sans y figurer (sans confirmation, ou ajouté entre la lecture et le geste) refuse tout et rend `aConfirmer`,
 * les files à nommer dans la confirmation. Refusé pendant un appel avec lui.
 */
export async function archiverProspect(
  entrepriseId: string,
  prospectId: string,
  par: Origine,
  filesConfirmees: readonly string[],
): Promise<{ ok: true; deja: boolean; retireDe: string[]; terminees: string[] } | (Refus & { aConfirmer?: FileEnAttente[] })> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ archiveLe: prospects.archiveLe })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)))
      .for('update');
    if (!p) return { ok: false as const, raison: 'Ce prospect n’existe pas dans cette entreprise.' };
    if (p.archiveLe) return { ok: true as const, deja: true, retireDe: [], terminees: [] };
    if (await tx.$count(appels, and(eq(appels.entrepriseId, entrepriseId), eq(appels.prospectId, prospectId), eq(appels.statut, 'en-cours')))) {
      return { ok: false as const, raison: 'Un appel avec ce prospect est en cours : archive-le quand il sera fini.' };
    }
    const files = await tx
      .select()
      .from(campagnes)
      .where(
        and(
          eq(campagnes.entrepriseId, entrepriseId),
          ne(campagnes.statut, 'terminee'),
          sql`exists (select 1 from jsonb_array_elements(${campagnes.entrees}) e where e->>'prospectId' = ${prospectId} and e->>'etat' in ('a-appeler', 'en-appel'))`,
        ),
      )
      .orderBy(campagnes.id)
      .for('update');
    if (files.some((c) => c.entrees.some((e) => e.prospectId === prospectId && e.etat === 'en-appel'))) {
      return { ok: false as const, raison: 'Ce prospect est en appel dans une campagne : archive-le quand l’appel sera fini.' };
    }
    // Campagnes verrouillées ci-dessus : leur file ne bouge plus jusqu'à la fin de la transaction.
    const nouvelles = filesNonConfirmees(await filesEnAttente(entrepriseId, prospectId, tx), filesConfirmees);
    if (nouvelles.length) {
      return {
        ok: false as const,
        raison: `Ce prospect attend dans la file de ${nouvelles.map((f) => f.libelle).join(' ; ')} : rien n’est archivé tant que son retrait de ${nouvelles.length > 1 ? 'ces files' : 'cette file'} n’est pas confirmé.`,
        aConfirmer: nouvelles,
      };
    }
    const trace = { le: new Date().toISOString(), par };
    const terminees: string[] = [];
    for (const c of files) {
      const campagne: Campagne = { id: c.id, entrepriseId: c.entrepriseId, versionScriptId: c.versionScriptId, statut: c.statut, entrees: c.entrees };
      const apres = retirer(campagne, prospectId, trace);
      if (apres.statut === 'terminee') terminees.push(c.id);
      await tx.update(campagnes).set({ statut: apres.statut, entrees: apres.entrees }).where(eq(campagnes.id, c.id));
    }
    await tx
      .update(prospects)
      .set({ archiveLe: new Date(), archivePar: par })
      .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
    return { ok: true as const, deja: false, retireDe: files.map((c) => c.id), terminees };
  });
}

/** Réactive un prospect archivé : il revient dans les listes et peut de nouveau être appelé. Il ne revient dans aucune file. */
export async function reactiverProspect(entrepriseId: string, prospectId: string): Promise<{ ok: true; deja: boolean } | Refus> {
  const [p] = await db
    .select({ archiveLe: prospects.archiveLe })
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  if (!p) return { ok: false, raison: 'Ce prospect n’existe pas dans cette entreprise.' };
  if (!p.archiveLe) return { ok: true, deja: true };
  await db
    .update(prospects)
    .set({ archiveLe: null, archivePar: null })
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  return { ok: true, deja: false };
}

/**
 * Les campagnes téléphone en cours où ces prospects attendent (à appeler, ou en appel) : l'application y compose
 * le numéro de la fiche au moment d'appeler, sans autre question. Changer ce numéro revient donc à faire sonner un
 * autre téléphone ; le serveur MCP le fait confirmer. Une campagne prête ou en pause redemande l'accord à son
 * lancement, sur des numéros relus à ce moment-là.
 */
export async function filesTelephoneEnCours(entrepriseId: string, prospectIds: readonly string[]): Promise<Map<string, string[]>> {
  const parProspect = new Map<string, string[]>();
  if (prospectIds.length === 0) return parProspect;
  const lignes = await db
    .select({ id: campagnes.id, entrees: campagnes.entrees })
    .from(campagnes)
    .where(and(eq(campagnes.entrepriseId, entrepriseId), eq(campagnes.ligne, 'bluetooth'), eq(campagnes.statut, 'en-cours')));
  const voulus = new Set(prospectIds);
  for (const c of lignes) {
    for (const x of c.entrees) {
      if (voulus.has(x.prospectId) && (x.etat === 'a-appeler' || x.etat === 'en-appel')) parProspect.set(x.prospectId, [...(parProspect.get(x.prospectId) ?? []), c.id]);
    }
  }
  return parProspect;
}
