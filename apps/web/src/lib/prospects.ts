import 'server-only';
import { type FicheProspect, type FichierImporte, type NumeroE164, fusionnerFiches, lireFiches, numerosAAutoriser } from '@autocalled/domain';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { consentements, imports, prospects, textesConsentement } from '@/db/schema';
import { numeroLisible } from './format';

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
 * décision de l'opérateur (ADR 0009). Un numéro révoqué ne l'est jamais à nouveau (`numerosAAutoriser`).
 */
export async function importerFiches(entrepriseId: string, fichiers: readonly FichierImporte[]): Promise<RapportImport> {
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
      .values({ entrepriseId, texteConsentementVersion: texte.version, nombreFiches: lecture.fiches.length })
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
