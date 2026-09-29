import 'server-only';
import { notFound } from 'next/navigation';
import { trouverEntreprise, trouverProspect } from './donnees';

/**
 * Lectures des pages, qui répondent par une 404 quand l'objet n'existe pas. À part de `donnees.ts` :
 * `next/navigation` ne se charge pas hors de Next (serveur MCP, scripts), où la condition `react-server`
 * donne une version de React sans `createContext`.
 */
export async function entrepriseParSlug(slug: string) {
  return (await trouverEntreprise(slug)) ?? notFound();
}

export async function prospectParId(entrepriseId: string, id: string) {
  return (await trouverProspect(entrepriseId, id)) ?? notFound();
}
