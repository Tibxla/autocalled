/**
 * Lien vers `chemin` avec les paramètres actuels modifiés : `null` retire un paramètre, une chaîne le pose.
 * L'ordre reste stable (paramètres existants d'abord, nouveaux ensuite) ; un paramètre vide disparaît.
 */
export function lienAvec(
  chemin: string,
  parametres: Record<string, string | undefined>,
  changements: Record<string, string | null>,
): string {
  const fusion = new Map<string, string>();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== '') fusion.set(cle, valeur);
  }
  for (const [cle, valeur] of Object.entries(changements)) {
    if (valeur === null || valeur === '') fusion.delete(cle);
    else fusion.set(cle, valeur);
  }
  const recherche = new URLSearchParams([...fusion]).toString();
  return recherche ? `${chemin}?${recherche}` : chemin;
}
