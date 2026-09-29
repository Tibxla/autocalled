import 'server-only';
import {
  ecrireFiche,
  type FicheProspect,
  type FichierImporte,
  type NumeroE164,
  fusionnerFiches,
  lireFiches,
  numerosAAutoriser,
} from '@autocalled/domain';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes, consentements, imports, prospects, textesConsentement } from '@/db/schema';
import type { Conflit, Refus } from './entreprises';
import { numeroLisible } from './format';
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
      numerosAutorises: number;
      numerosRevoques: string[];
    };

/**
 * Importe des fiches prospect Markdown dans une entreprise et enregistre le consentement de leurs numéros
 * (ADR 0001). L'appelant atteste ce consentement : l'interface par sa case à cocher, le serveur MCP par
 * décision de l'opérateur (ADR 0009) ; `canal` garde la trace de la porte d'entrée. Un numéro révoqué ne l'est
 * jamais à nouveau (`numerosAAutoriser`).
 */
export async function importerFiches(
  entrepriseId: string,
  fichiers: readonly FichierImporte[],
  canal: 'interface' | 'mcp' = 'interface',
): Promise<RapportImport> {
  if (fichiers.length > FICHIERS_MAX) return { etat: 'erreur', message: `${FICHIERS_MAX} fichiers au plus par import.` };
  const trop = fichiers.find((f) => Buffer.byteLength(f.contenu) > TAILLE_MAX);
  if (trop) return { etat: 'erreur', message: `« ${trop.nomFichier} » dépasse 32 Ko : une fiche tient en quelques paragraphes.` };

  const lecture = lireFiches(fichiers);
  if (lecture.fiches.length === 0) return { etat: 'fait', crees: [], misAJour: [], inchanges: [], refus: lecture.refus, numerosAutorises: 0, numerosRevoques: [] };

  const [texte] = await db.select().from(textesConsentement).orderBy(desc(textesConsentement.version)).limit(1);
  if (!texte) return { etat: 'erreur', message: 'Aucun texte de consentement en base : lance les migrations.' };

  const existantes: FicheProspect[] = (
    await db.select().from(prospects).where(eq(prospects.entrepriseId, entrepriseId))
  ).map((p) => ({ ...p, telephone: p.telephone as NumeroE164 }));
  const fusion = fusionnerFiches(existantes, lecture.fiches);

  const tri = await db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(imports)
      .values({ entrepriseId, texteConsentementVersion: texte.version, nombreFiches: lecture.fiches.length, canal })
      .returning({ id: imports.id });
    if (!imp) throw new Error('import impossible');

    for (const fiche of [...fusion.crees, ...fusion.misAJour]) {
      const valeurs = { ...fiche, entrepriseId, importId: imp.id, majLe: new Date() };
      await tx.insert(prospects).values(valeurs).onConflictDoUpdate({ target: [prospects.entrepriseId, prospects.id], set: valeurs });
    }

    const numeros = lecture.fiches.map((f) => f.telephone);
    const connus = await tx
      .select({ numero: consentements.numero, revoqueLe: consentements.revoqueLe })
      .from(consentements)
      .where(inArray(consentements.numero, numeros));
    const tri = numerosAAutoriser(numeros, connus);
    if (tri.aAutoriser.length > 0) {
      await tx.insert(consentements).values(tri.aAutoriser.map((numero) => ({ numero, texteVersion: texte.version, importId: imp.id })));
    }
    return tri;
  });

  return {
    etat: 'fait',
    crees: fusion.crees.map((f) => f.id),
    misAJour: fusion.misAJour.map((f) => f.id),
    inchanges: fusion.inchanges,
    refus: lecture.refus,
    numerosAutorises: tri.aAutoriser.length,
    numerosRevoques: tri.revoques.map(numeroLisible),
  };
}

/** Révoque le numéro pour tous les prospects qui le partagent : il ne sera plus jamais composé. */
export async function revoquerNumero(numero: string): Promise<number> {
  const revoques = await db
    .update(consentements)
    .set({ revoqueLe: new Date() })
    .where(and(eq(consentements.numero, numero), isNull(consentements.revoqueLe)))
    .returning({ id: consentements.id });
  return revoques.length;
}

/**
 * Si le consentement actif de ce numéro est entré par le serveur MCP, sa date ; sinon null. Un numéro glissé
 * dans un import par une consigne injectée serait autorisé : la confirmation d'un appel le signale.
 */
export async function ajoutParMcp(numero: string): Promise<Date | null> {
  const [ligne] = await db
    .select({ le: consentements.accordeLe })
    .from(consentements)
    .innerJoin(imports, eq(imports.id, consentements.importId))
    .where(and(eq(consentements.numero, numero), isNull(consentements.revoqueLe), eq(imports.canal, 'mcp')))
    .orderBy(desc(consentements.accordeLe))
    .limit(1);
  return ligne?.le ?? null;
}

/** Le texte de consentement que tout nouvel import fait accepter : la dernière version en base. */
export async function texteConsentementEnVigueur(): Promise<{ version: number; texte: string } | null> {
  const [texte] = await db
    .select({ version: textesConsentement.version, texte: textesConsentement.texte })
    .from(textesConsentement)
    .orderBy(desc(textesConsentement.version))
    .limit(1);
  return texte ?? null;
}

/** Les consentements d'un numéro, du plus récent au plus ancien, avec la porte d'entrée de leur import. */
export async function consentementsDuNumero(
  numero: string,
): Promise<{ accordeLe: Date; revoqueLe: Date | null; texteVersion: number; canal: 'interface' | 'mcp' }[]> {
  return db
    .select({ accordeLe: consentements.accordeLe, revoqueLe: consentements.revoqueLe, texteVersion: consentements.texteVersion, canal: imports.canal })
    .from(consentements)
    .innerJoin(imports, eq(imports.id, consentements.importId))
    .where(eq(consentements.numero, numero))
    .orderBy(desc(consentements.accordeLe));
}

/**
 * Corrige la fiche d'un prospect par la machinerie de l'import d'une seule fiche : mêmes contrôles (numéro
 * normalisé, adresse, contexte), une ligne `imports` au canal donné, consentement du nouveau numéro sauf s'il est
 * révoqué. Refusé si la fiche a changé depuis `connu` (son `majLe` lu, en ISO). L'identifiant ne change jamais.
 */
export async function modifierProspect(
  entrepriseId: string,
  prospectId: string,
  champs: PatchFiche,
  o: { canal: 'interface' | 'mcp'; connu?: string | null },
): Promise<{ ok: true; rapport: Extract<RapportImport, { etat: 'fait' }> } | Refus | Conflit> {
  const [actuel] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
  if (!actuel) return { ok: false, raison: 'Ce prospect n’existe pas dans cette entreprise.' };
  if (o.connu != null && Date.parse(o.connu) !== actuel.majLe.getTime()) {
    return {
      ok: false,
      raison: 'La fiche a changé depuis ta lecture (import ou autre correction) : relis-la avant de la corriger.',
      conflit: { le: actuel.majLe, origine: null, jeton: actuel.majLe.toISOString() },
    };
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
  const rapport = await importerFiches(entrepriseId, [ecrireFiche(fiche)], o.canal);
  if (rapport.etat === 'erreur') return { ok: false, raison: rapport.message };
  if (rapport.etat === 'vide') return { ok: false, raison: 'Rien à enregistrer.' };
  const refus = rapport.refus[0];
  if (refus) return { ok: false, raison: `Fiche refusée, rien n’est écrit : ${refus.erreurs.join(' ; ')}.` };
  return { ok: true, rapport };
}

type Lecteur = Pick<typeof db, 'select' | '$count'>;

/**
 * Pourquoi la fiche de ce prospect ne peut pas être supprimée maintenant, ou null : il attend dans la file d'une
 * campagne non terminée, ou un appel avec lui est en cours.
 */
export async function obstacleSuppressionProspect(entrepriseId: string, prospectId: string, lecteur: Lecteur = db): Promise<string | null> {
  const enFile = await lecteur
    .select({ id: campagnes.id })
    .from(campagnes)
    .where(
      and(
        eq(campagnes.entrepriseId, entrepriseId),
        ne(campagnes.statut, 'terminee'),
        sql`exists (select 1 from jsonb_array_elements(${campagnes.entrees}) e where e->>'prospectId' = ${prospectId} and e->>'etat' in ('a-appeler', 'en-appel'))`,
      ),
    );
  if (enFile.length) {
    return `Ce prospect attend dans la file de ${enFile.length > 1 ? `${enFile.length} campagnes` : 'la campagne'} ${enFile.map((c) => c.id).join(', ')} : retire-le d’abord (retirer_de_la_file).`;
  }
  const enCours = await lecteur.$count(appels, and(eq(appels.entrepriseId, entrepriseId), eq(appels.prospectId, prospectId), eq(appels.statut, 'en-cours')));
  return enCours > 0 ? 'Un appel avec ce prospect est en cours : attends qu’il finisse.' : null;
}

/**
 * Supprime la fiche d'un prospect. Ses appels et bilans restent, rattachés par l'identifiant (un réimport du même
 * fichier les retrouve), et le consentement de son numéro reste : `revoquerNumero` pour ne plus jamais l'appeler.
 * Refusé tant qu'il attend dans la file d'une campagne non terminée ou qu'un appel avec lui est en cours.
 */
export async function supprimerProspect(entrepriseId: string, prospectId: string): Promise<{ ok: true; appelsGardes: number } | Refus> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)))
      .for('update');
    if (!p) return { ok: false as const, raison: 'Ce prospect n’existe pas dans cette entreprise.' };
    const obstacle = await obstacleSuppressionProspect(entrepriseId, prospectId, tx);
    if (obstacle) return { ok: false as const, raison: obstacle };
    const appelsGardes = await tx.$count(appels, and(eq(appels.entrepriseId, entrepriseId), eq(appels.prospectId, prospectId)));
    await tx.delete(prospects).where(and(eq(prospects.entrepriseId, entrepriseId), eq(prospects.id, prospectId)));
    return { ok: true as const, appelsGardes };
  });
}
