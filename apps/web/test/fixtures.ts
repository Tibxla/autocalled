import { db } from '@/db';
import { entreprises } from '@/db/schema';

/** Données fictives : numéros de la tranche que l'ARCEP réserve à la fiction (06 39 98 00 xx). */
export function fiche(id: string, nom: string, telephone: string, contexte = 'Contexte fictif.'): { nomFichier: string; contenu: string } {
  return { nomFichier: `${id}.md`, contenu: `---\nnom: ${nom}\nsociete: Société fictive\ntelephone: "${telephone}"\n---\n\n${contexte}\n` };
}

export async function entrepriseDeTest(nom = 'Gîte fictif', slug = 'gite-fictif') {
  const [creee] = await db.insert(entreprises).values({ nom, slug }).returning();
  if (!creee) throw new Error('entreprise de test non créée');
  return creee;
}
