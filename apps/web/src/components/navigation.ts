/**
 * Les cinq entrées de la navigation principale, partagées par la barre du haut (dès 640 px) et la barre du bas
 * (sous 640 px). Module sans directive : un tableau exporté d'un module client arriverait dans un composant
 * serveur comme une référence client, pas comme un tableau.
 */
export interface EntreeNav {
  href: string;
  libelle: string;
  /** Seul le chemin exact rend l'entrée courante (l'accueil). */
  exact?: boolean;
  /** Autres chemins rattachés (une campagne relève d'Entreprises). */
  aussi?: string[];
}

export const NAVIGATION_PRINCIPALE: readonly EntreeNav[] = [
  { href: '/', libelle: 'Accueil', exact: true },
  { href: '/entreprises', libelle: 'Entreprises', aussi: ['/campagnes'] },
  { href: '/appels', libelle: 'Appels' },
  { href: '/telephone', libelle: 'Téléphone' },
  { href: '/reglages', libelle: 'Réglages' },
];

function correspond(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`);
}

/** L'entrée est-elle la page courante ? */
export function estCourante(chemin: string, { href, exact = false, aussi = [] }: Pick<EntreeNav, 'href' | 'exact' | 'aussi'>): boolean {
  return exact ? chemin === href : correspond(chemin, href) || aussi.some((p) => correspond(chemin, p));
}
