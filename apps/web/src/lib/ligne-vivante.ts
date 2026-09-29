import 'server-only';
import { etatLigneServeur, type EtatLigneServeur } from './accueil';

/**
 * L'état de la ligne téléphone lu pour une page, borné dans le temps : au-delà, la page s'affiche sans lui (un pont
 * qui pend ne la bloque pas). LECTURE SEULE.
 */
export async function etatLigneBorne(attenteMs = 1500): Promise<EtatLigneServeur | null> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const attente = new Promise<null>((resoudre) => {
    minuterie = setTimeout(() => resoudre(null), attenteMs);
  });
  try {
    return await Promise.race([etatLigneServeur(), attente]);
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/** L'appel que la ligne téléphone porte en ce moment, d'après un état lu, ou null. */
export function appelIdVivant(etat: EtatLigneServeur | null): string | null {
  return etat?.joignable && etat.appelEnCours && etat.appelId ? etat.appelId : null;
}

/** L'appel que la ligne téléphone porte en ce moment, ou null (pont muet ou trop lent). */
export async function appelTelephoneVivant(attenteMs = 1500): Promise<string | null> {
  return appelIdVivant(await etatLigneBorne(attenteMs));
}
