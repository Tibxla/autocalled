import { ISSUES_SYSTEME } from '@autocalled/domain';
import { type FiltresAppels, ISSUE_NON_COMPOSE, ISSUE_SANS_BILAN, periodeValide } from '@/lib/lecture';

/**
 * Filtres de la liste des appels lus dans l'URL, partagés par la liste et la fiche d'appel (appel précédent
 * et suivant) : les deux voient la même liste. Un paramètre incompris est retiré, pas signalé.
 */

export const LIGNES_FILTRE = [
  { valeur: 'bluetooth', libelle: 'Téléphone' },
  { valeur: 'navigateur', libelle: 'Navigateur' },
  { valeur: 'simulation', libelle: 'Simulés' },
  { valeur: 'twilio', libelle: 'Twilio' },
] as const;

export type ParametresAppels = {
  q?: string;
  entreprise?: string;
  issue?: string;
  ligne?: string;
  version?: string;
  periode?: string;
  /** Curseur : l'identifiant du dernier appel de la page d'avant. */
  avant?: string;
};

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function issueValide(valeur: string | undefined): string | undefined {
  if (!valeur) return undefined;
  if ((ISSUES_SYSTEME as readonly string[]).includes(valeur) || valeur === ISSUE_NON_COMPOSE || valeur === ISSUE_SANS_BILAN) return valeur;
  return valeur.startsWith('perso:') && FORME_UUID.test(valeur.slice(6)) ? valeur : undefined;
}

/**
 * Les paramètres compris (à remettre dans les liens) et les filtres de la base. Sans ligne choisie, seuls les
 * appels réels comptent (CONTEXT.md) : les simulés sont à part, sous « Simulés ».
 */
export function lireFiltresAppels(p: Record<string, string | undefined>): { parametres: ParametresAppels; filtres: FiltresAppels } {
  const q = p.q?.trim() || undefined;
  const ligne = LIGNES_FILTRE.some((l) => l.valeur === p.ligne) ? p.ligne : undefined;
  const periodeLue = periodeValide(p.periode);
  const periode = periodeLue && periodeLue !== 'tout' ? periodeLue : undefined;
  const parametres: ParametresAppels = {
    q,
    entreprise: p.entreprise || undefined,
    issue: issueValide(p.issue),
    ligne,
    version: p.version && FORME_UUID.test(p.version) ? p.version : undefined,
    periode,
    avant: p.avant && FORME_UUID.test(p.avant) ? p.avant : undefined,
  };
  const filtres: FiltresAppels = { reels: true };
  if (q) filtres.recherche = q;
  if (parametres.entreprise) filtres.entreprise = parametres.entreprise;
  if (parametres.issue) filtres.issue = parametres.issue;
  if (ligne) filtres.ligne = ligne;
  if (parametres.version) filtres.version = parametres.version;
  if (periode) filtres.periode = periode;
  return { parametres, filtres };
}
