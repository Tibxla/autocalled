import 'server-only';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { dossierDonnees } from './appels';
import { commanderPont, type ReponsePont } from './pont';

type Diagnostic = { texte: string; alerte: boolean };

export function expliquerLigneEntrante(etat: ReponsePont): Diagnostic {
  if (!etat.ok) return { texte: 'Le pont ne répond pas : l’assistante ne peut pas décrocher.', alerte: true };
  const ligne = etat.corps;
  if (typeof ligne.connecte !== 'boolean') return { texte: 'L’état du téléphone est illisible : le décroché ne peut pas être vérifié.', alerte: true };
  if (ligne.connecte !== true) return { texte: 'Le téléphone passerelle est déconnecté.', alerte: true };
  if (ligne.entrantEnCours && !ligne.appelId) return { texte: 'Un appel entrant sonne. La décision est en cours ou cet appel ne remplit pas les conditions de décroché.', alerte: false };
  if (ligne.appelEnCours || ligne.entrantEnCours) return { texte: 'La ligne est occupée. Un autre appel entrant restera sans décroché.', alerte: false };
  return { texte: 'Téléphone connecté, ligne disponible.', alerte: false };
}

/** Seulement des phrases prédéfinies : aucune ligne du journal, parole ou coordonnée ne part vers le navigateur. */
export function expliquerDernierEntrant(appel: { statut: string; conversationId: string | null }, journal: string): Diagnostic {
  if (appel.statut === 'en-cours') return { texte: 'Appel entrant reconnu, encore en cours.', alerte: false };
  const lignes = journal.split('\n').map((ligne) => ligne.replace(/^\d{2}:\d{2}:\d{2} \+\s*\d+(?:\.\d+)?s /, ''));
  const decrocheImpossible = lignes.find((ligne) => /^(?:décroché impossible|le téléphone n'a pas décroché)\s*:/.test(ligne));
  if (decrocheImpossible) {
    return /D-Bus/.test(decrocheImpossible)
      ? { texte: 'Le prospect a été reconnu, mais le téléphone n’a pas répondu à la commande de décroché (D-Bus).', alerte: true }
      : { texte: 'Le prospect a été reconnu, mais le téléphone n’a pas pu décrocher.', alerte: true };
  }
  if (lignes.some((ligne) => /^bilan : .*['"]raison['"]:\s*['"]canal son absent['"]/.test(ligne))) return { texte: 'Le téléphone n’a pas ouvert le canal son de cet appel.', alerte: true };
  if (appel.conversationId) return { texte: 'Une conversation a été ouverte. Cette trace ne confirme pas que l’appelant entendait l’assistante.', alerte: false };
  return { texte: 'Appel reconnu, terminé sans conversation. La trace disponible ne permet pas de préciser pourquoi.', alerte: true };
}

async function finDuJournal(id: string): Promise<string> {
  let fichier;
  try {
    fichier = await open(join(dossierDonnees(), 'pont', `${id}.log`), 'r');
    const { size } = await fichier.stat();
    const longueur = Math.min(size, 64 * 1024);
    const contenu = Buffer.alloc(longueur);
    const { bytesRead } = await fichier.read(contenu, 0, longueur, size - longueur);
    return contenu.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await fichier?.close();
  }
}

export async function lireDiagnosticEntrants() {
  const [etat, [dernier]] = await Promise.all([
    commanderPont('/etat', undefined, { delaiMs: 2000 }),
    db.select({ id: appels.id, debutLe: appels.debutLe, statut: appels.statut, conversationId: appels.conversationId })
      .from(appels).where(eq(appels.sens, 'entrant')).orderBy(desc(appels.debutLe)).limit(1),
  ]);
  return {
    ligne: expliquerLigneEntrante(etat),
    dernier: dernier ? { id: dernier.id, le: dernier.debutLe.toISOString(), ...expliquerDernierEntrant(dernier, await finDuJournal(dernier.id)) } : null,
  };
}
