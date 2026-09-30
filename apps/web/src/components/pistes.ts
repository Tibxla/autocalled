/**
 * Les colonnes d'un tableau dense, rendues souples : chaque piste de largeur fixe (« 230px », « 9rem ») ou bornée
 * (« minmax(10rem,14rem) ») peut céder jusqu'à zéro, et garde sa largeur dès qu'il y a la place (la grille agrandit
 * les pistes fixes jusqu'à leur plafond avant de donner le reste aux fractions). Sans cela, de 640 à 800 px (un
 * téléphone couché, une petite fenêtre), la somme des colonnes fixes dépassait la page, qui défilait en largeur.
 * Les fractions et `auto` restent telles quelles.
 */
export function pistesSouples(colonnes: string): string {
  return decouper(colonnes)
    .map((piste) => {
      const borne = /^minmax\((.*)\)$/.exec(piste);
      if (borne) {
        const [, plafond] = decouper((borne[1] as string).replace(/,/g, ' , ')).join(' ').split(' , ');
        return plafond && !/fr$/.test(plafond.trim()) ? `minmax(0,${plafond.trim()})` : piste;
      }
      return /^\d*\.?\d+(px|rem|em|%)$/.test(piste) ? `minmax(0,${piste})` : piste;
    })
    .join(' ');
}

/** Découpe une liste de pistes aux espaces hors parenthèses. */
function decouper(texte: string): string[] {
  const pistes: string[] = [];
  let profondeur = 0;
  let courante = '';
  for (const c of texte.trim()) {
    if (c === '(') profondeur += 1;
    if (c === ')') profondeur -= 1;
    if (c === ' ' && profondeur === 0) {
      if (courante) pistes.push(courante);
      courante = '';
    } else courante += c;
  }
  if (courante) pistes.push(courante);
  return pistes;
}
