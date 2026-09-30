/**
 * Les entrées de la navigation principale, partagées par la barre du haut (dès 640 px) et la barre du bas (sous
 * 640 px). Module sans directive : un tableau exporté d'un module client arriverait dans un composant serveur comme
 * une référence client, pas comme un tableau.
 *
 * « Assistante » ne tient que dans la barre du haut dès 1280 px (`large`) : la barre du bas est mesurée pour cinq
 * liens, et en dessous de 1280 px la barre du haut n'a plus de place à droite pour la campagne et l'état de la ligne. Ailleurs, la page
 * Assistante s'ouvre depuis Réglages, qui s'allume alors à sa place (`aussiSansLarge`).
 */
export interface EntreeNav {
  href: string;
  libelle: string;
  /** Seul le chemin exact rend l'entrée courante (l'accueil). */
  exact?: boolean;
  /** Autres chemins rattachés (une campagne relève d'Entreprises). */
  aussi?: string[];
  /** Barre du haut dès 1280 px seulement. */
  large?: boolean;
  /** Chemins rattachés là où les entrées `large` n'ont pas de lien (barre du bas, barre du haut sous 1280 px). */
  aussiSansLarge?: string[];
}

export const NAVIGATION_PRINCIPALE: readonly EntreeNav[] = [
  { href: '/', libelle: 'Accueil', exact: true },
  { href: '/entreprises', libelle: 'Entreprises', aussi: ['/campagnes'] },
  { href: '/appels', libelle: 'Appels' },
  { href: '/telephone', libelle: 'Téléphone' },
  { href: '/assistante', libelle: 'Assistante', large: true },
  { href: '/reglages', libelle: 'Réglages', aussiSansLarge: ['/assistante'] },
];

/** Les entrées d'une navigation sans les entrées `large`, chacune avec ses chemins rattachés à leur place. */
export function sansEntreesLarges(entrees: readonly EntreeNav[]): EntreeNav[] {
  return entrees.filter((e) => !e.large).map((e) => (e.aussiSansLarge ? { ...e, aussi: [...(e.aussi ?? []), ...e.aussiSansLarge] } : e));
}

function correspond(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`);
}

/** L'entrée est-elle la page courante ? */
export function estCourante(chemin: string, { href, exact = false, aussi = [] }: Pick<EntreeNav, 'href' | 'exact' | 'aussi'>): boolean {
  return exact ? chemin === href : correspond(chemin, href) || aussi.some((p) => correspond(chemin, p));
}
