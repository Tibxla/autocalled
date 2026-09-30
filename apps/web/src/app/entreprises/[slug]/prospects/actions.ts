'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { entreprises } from '@/db/schema';
import { trouverProspect } from '@/lib/donnees';
import * as effacement from '@/lib/effacement';
import type { ResultatAction } from '@/lib/formulaire';
import { exigerOperateur } from '@/lib/garde';
import * as prospects from '@/lib/prospects';

export type { RapportImport } from '@/lib/prospects';
export type { RapportEffacement } from '@/lib/effacement';

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTROUVABLE = 'Ce prospect n’existe plus : relis la page.';

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

export type { FileEnAttente } from '@/lib/prospects';

/**
 * Archive un prospect (ADR 0013) : un frein, réversible, sans confirmation, sauf s'il attend dans la file d'une
 * campagne non terminée. Alors rien n'est fait et `aConfirmer` nomme ces campagnes pour la confirmation en ligne ; le
 * geste confirmé repasse avec leurs identifiants (`filesConfirmees`). `retireDe` : les campagnes dont il a quitté la
 * file ; `terminees` : celles qui n'avaient plus personne d'autre à appeler.
 */
export async function archiverProspect(
  entrepriseId: string,
  prospectId: string,
  filesConfirmees: string[] = [],
): Promise<ResultatAction<{ retireDe: number; terminees: number }> | { ok: false; raison: string; aConfirmer: prospects.FileEnAttente[] }> {
  await exigerOperateur();
  if (!FORME_UUID.test(entrepriseId)) return { ok: false, raison: INTROUVABLE };
  if (!Array.isArray(filesConfirmees) || filesConfirmees.length > 50 || !filesConfirmees.every((id) => typeof id === 'string' && FORME_UUID.test(id))) {
    return { ok: false, raison: 'Confirmation illisible : relis la page.' };
  }
  const r = await prospects.archiverProspect(entrepriseId, prospectId, 'interface', filesConfirmees);
  if (!r.ok) return r.aConfirmer ? { ok: false, raison: r.raison, aConfirmer: r.aConfirmer } : { ok: false, raison: r.raison };
  revalidatePath('/entreprises', 'layout');
  return { ok: true, retireDe: r.retireDe.length, terminees: r.terminees.length };
}

export async function reactiverProspect(entrepriseId: string, prospectId: string): Promise<ResultatAction> {
  await exigerOperateur();
  if (!FORME_UUID.test(entrepriseId)) return { ok: false, raison: INTROUVABLE };
  const r = await prospects.reactiverProspect(entrepriseId, prospectId);
  if (!r.ok) return r;
  revalidatePath('/entreprises', 'layout');
  return { ok: true };
}

/** Ce que l'effacement de ce prospect supprimerait, rédigé pour la confirmation en ligne ; `obstacle` s'il est refusé. */
export async function inventaireEffacement(
  entrepriseId: string,
  prospectId: string,
): Promise<ResultatAction<{ efface: string[]; reste: string[]; obstacle: string | null }>> {
  await exigerOperateur();
  if (!FORME_UUID.test(entrepriseId)) return { ok: false, raison: INTROUVABLE };
  const inv = await effacement.inventaireEffacement(entrepriseId, prospectId);
  if (!inv) return { ok: false, raison: INTROUVABLE };
  return { ok: true, ...effacement.phrasesEffacement(inv, undefined, { numeroInsecable: true }), obstacle: inv.obstacle };
}

/**
 * Efface la personne que porte ce prospect (ADR 0013), après la confirmation en ligne. Depuis la liste, le rapport
 * revient à la page ; depuis la fiche, qui n'existe plus, on repart vers la liste avec le rapport dans l'adresse
 * (des comptes, sans nom ni numéro).
 */
export async function effacerLaPersonne(
  entrepriseId: string,
  prospectId: string,
  depuisFiche = false,
): Promise<ResultatAction<{ rapport: effacement.RapportEffacement }>> {
  await exigerOperateur();
  if (!FORME_UUID.test(entrepriseId) || !(await trouverProspect(entrepriseId, prospectId))) return { ok: false, raison: INTROUVABLE };
  const r = await effacement.effacerPersonne(entrepriseId, prospectId, 'interface');
  if (!r.ok) return r;
  const rapport = effacement.rapportEffacement(r);
  revalidatePath('/entreprises', 'layout');
  if (depuisFiche) {
    const [e] = await db.select({ slug: entreprises.slug }).from(entreprises).where(eq(entreprises.id, entrepriseId));
    redirect(`/entreprises/${e?.slug ?? ''}/prospects?efface=${effacement.encoderRapport(rapport)}`);
  }
  return { ok: true, rapport };
}
