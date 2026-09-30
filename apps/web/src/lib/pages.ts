import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { lireAssistante } from './assistante';
import { trouverEntreprise, trouverProspect } from './donnees';

/**
 * Lectures des pages, qui répondent par une 404 quand l'objet n'existe pas. À part de `donnees.ts` :
 * `next/navigation` ne se charge pas hors de Next (serveur MCP, scripts), où la condition `react-server`
 * donne une version de React sans `createContext`.
 */

/**
 * L'entreprise d'un slug, lue une seule fois par requête : le layout de l'entreprise, sa page et leurs
 * métadonnées partagent ce résultat (`cache` de React, propre à chaque requête). Null si le slug est inconnu.
 */
export const lireEntreprise = cache(trouverEntreprise);

export const entrepriseParSlug = cache(async (slug: string) => (await lireEntreprise(slug)) ?? notFound());

export async function prospectParId(entrepriseId: string, id: string) {
  return (await trouverProspect(entrepriseId, id)) ?? notFound();
}

/** Le nom et le premier message de l'assistante, lus une seule fois par requête (layout, pages, métadonnées). */
export const assistantePourLaPage = cache(lireAssistante);
