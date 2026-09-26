import type { z } from 'zod';

/** Retour d'une action de formulaire : erreurs par champ, ou message global. */
export type EtatFormulaire = { erreurs?: Record<string, string>; message?: string; ok?: boolean } | null;

export function erreursDeZod(erreur: z.ZodError): Record<string, string> {
  const erreurs: Record<string, string> = {};
  for (const issue of erreur.issues) {
    const champ = String(issue.path[0] ?? '');
    erreurs[champ] ??= issue.message;
  }
  return erreurs;
}
