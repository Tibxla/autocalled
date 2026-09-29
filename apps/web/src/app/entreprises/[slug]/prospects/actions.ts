'use server';

import { revalidatePath } from 'next/cache';
import type { ResultatAction } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import * as prospects from '@/lib/prospects';

export type { RapportImport } from '@/lib/prospects';

export async function importerFiches(entrepriseId: string, _: prospects.RapportImport, donnees: FormData): Promise<prospects.RapportImport> {
  await exigerOperateur();
  if (donnees.get('consentement') !== 'on') {
    return { etat: 'erreur', message: 'Confirme que chaque personne de la liste a accepté le texte de consentement.' };
  }
  const fichiers = donnees.getAll('fiches').filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) return { etat: 'erreur', message: 'Choisis au moins un fichier .md.' };
  // Contrôlés avant de lire les fichiers ; la bibliothèque les revérifie pour le serveur MCP.
  if (fichiers.length > prospects.FICHIERS_MAX) return { etat: 'erreur', message: `${prospects.FICHIERS_MAX} fichiers au plus par import.` };
  const trop = fichiers.find((f) => f.size > prospects.TAILLE_MAX);
  if (trop) return { etat: 'erreur', message: `« ${trop.name} » dépasse 32 Ko : une fiche tient en quelques paragraphes.` };

  const rapport = await prospects.importerFiches(
    entrepriseId,
    await Promise.all(fichiers.map(async (f) => ({ nomFichier: f.name, contenu: await f.text() }))),
    'interface',
  );
  revalidatePath('/entreprises', 'layout');
  return rapport;
}

/**
 * Révoque le numéro pour tous les prospects qui le partagent : il ne sera plus jamais composé. `revoques` :
 * les consentements actifs clos à l'instant (zéro si le numéro l'était déjà).
 */
export async function revoquerNumero(numero: string): Promise<ResultatAction<{ revoques: number }>> {
  await exigerOperateur();
  const revoques = await prospects.revoquerNumero(numero);
  revalidatePath('/entreprises', 'layout');
  return { ok: true, revoques };
}
