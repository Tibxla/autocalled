'use client';

import { createContext, useContext } from 'react';

/**
 * Le nom de l'assistante, lu en base par le layout (lib/pages.ts, `assistantePourLaPage`) et transmis aux
 * composants client : chaque libellé visible le prend ici, jamais en dur. Les composants serveur lisent
 * `assistantePourLaPage()` directement. Le nom d'un appel passé est celui figé sur l'appel (`assistanteNom`).
 */
const NomAssistante = createContext('Mina');

export function FournisseurAssistante({ nom, children }: { nom: string; children: React.ReactNode }) {
  return <NomAssistante value={nom}>{children}</NomAssistante>;
}

export function useNomAssistante(): string {
  return useContext(NomAssistante);
}

/** Le nom, en texte : pour un composant serveur qui ne lit pas la base (écran de chargement). */
export function NomDeLAssistante() {
  return useNomAssistante();
}
