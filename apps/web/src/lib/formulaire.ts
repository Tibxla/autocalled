import type { z } from 'zod';

/** Retour d'une action hors formulaire (archiver, effacer, relire) : ce qui a été fait, ou pourquoi rien. */
export type ResultatAction<T extends object = object> = ({ ok: true } & T) | { ok: false; raison: string };

/**
 * Retour d'une action de formulaire : erreurs par champ, ou message global. `conflit` : la donnée a changé depuis
 * l'ouverture du formulaire ; renvoyer `jeton` (champ `ecraser`) enregistre la saisie par-dessus.
 */
export type EtatFormulaire = { erreurs?: Record<string, string>; message?: string; ok?: boolean; conflit?: { jeton: string } } | null;

/** Le jeton de la garde de concurrence : `ecraser` (bouton Écraser) prime sur le champ caché `connu`. */
export function jetonConnu(donnees: FormData): string | null {
  const valeur = donnees.get('ecraser') ?? donnees.get('connu');
  return typeof valeur === 'string' && valeur ? valeur : null;
}

export function erreursDeZod(erreur: z.ZodError): Record<string, string> {
  const erreurs: Record<string, string> = {};
  for (const issue of erreur.issues) {
    const champ = String(issue.path[0] ?? '');
    erreurs[champ] ??= issue.message;
  }
  return erreurs;
}
