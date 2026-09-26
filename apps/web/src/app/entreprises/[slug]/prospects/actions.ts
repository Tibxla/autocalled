'use server';

import { type FicheProspect, type NumeroE164, fusionnerFiches, lireFiches } from '@autocalled/domain';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { consentements, imports, prospects, textesConsentement } from '@/db/schema';
import { exigerOperateur } from '@/lib/garde';

const FICHIERS_MAX = 100;
const TAILLE_MAX = 32 * 1024;

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
    };

export async function importerFiches(entrepriseId: string, _: RapportImport, donnees: FormData): Promise<RapportImport> {
  await exigerOperateur();
  if (donnees.get('consentement') !== 'on') {
    return { etat: 'erreur', message: 'Confirme que chaque personne de la liste a accepté le texte de consentement.' };
  }
  const fichiers = donnees.getAll('fiches').filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) return { etat: 'erreur', message: 'Choisis au moins un fichier .md.' };
  if (fichiers.length > FICHIERS_MAX) return { etat: 'erreur', message: `${FICHIERS_MAX} fichiers au plus par import.` };

  const trop = fichiers.find((f) => f.size > TAILLE_MAX);
  if (trop) return { etat: 'erreur', message: `« ${trop.name} » dépasse 32 Ko : une fiche tient en quelques paragraphes.` };

  const lecture = lireFiches(await Promise.all(fichiers.map(async (f) => ({ nomFichier: f.name, contenu: await f.text() }))));
  if (lecture.fiches.length === 0) return { etat: 'fait', crees: [], misAJour: [], inchanges: [], refus: lecture.refus, numerosAutorises: 0 };

  const [texte] = await db.select().from(textesConsentement).orderBy(desc(textesConsentement.version)).limit(1);
  if (!texte) return { etat: 'erreur', message: 'Aucun texte de consentement en base : lance les migrations.' };

  const existantes: FicheProspect[] = (
    await db.select().from(prospects).where(eq(prospects.entrepriseId, entrepriseId))
  ).map((p) => ({ ...p, telephone: p.telephone as NumeroE164 }));
  const fusion = fusionnerFiches(existantes, lecture.fiches);

  const numerosAutorises = await db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(imports)
      .values({ entrepriseId, texteConsentementVersion: texte.version, nombreFiches: lecture.fiches.length })
      .returning({ id: imports.id });
    if (!imp) throw new Error('import impossible');

    for (const fiche of [...fusion.crees, ...fusion.misAJour]) {
      const valeurs = { ...fiche, entrepriseId, importId: imp.id, majLe: new Date() };
      await tx.insert(prospects).values(valeurs).onConflictDoUpdate({ target: [prospects.entrepriseId, prospects.id], set: valeurs });
    }

    // Un numéro qui a déjà un consentement actif le garde ; les autres reçoivent celui de cet import.
    const numeros = [...new Set(lecture.fiches.map((f) => f.telephone))];
    const actifs = await tx
      .select({ numero: consentements.numero })
      .from(consentements)
      .where(and(inArray(consentements.numero, numeros), isNull(consentements.revoqueLe)));
    const aAutoriser = numeros.filter((n) => !actifs.some((a) => a.numero === n));
    if (aAutoriser.length > 0) {
      await tx.insert(consentements).values(aAutoriser.map((numero) => ({ numero, texteVersion: texte.version, importId: imp.id })));
    }
    return aAutoriser.length;
  });

  revalidatePath('/entreprises', 'layout');
  return {
    etat: 'fait',
    crees: fusion.crees.map((f) => f.id),
    misAJour: fusion.misAJour.map((f) => f.id),
    inchanges: fusion.inchanges,
    refus: lecture.refus,
    numerosAutorises,
  };
}

/** Révoque le numéro pour tous les prospects qui le partagent : il ne sera plus jamais composé. */
export async function revoquerNumero(numero: string) {
  await exigerOperateur();
  await db
    .update(consentements)
    .set({ revoqueLe: new Date() })
    .where(and(eq(consentements.numero, numero), isNull(consentements.revoqueLe)));
  revalidatePath('/entreprises', 'layout');
}
