import { ISSUES_SYSTEME, type IssueSysteme } from '@autocalled/domain';
import { issueEffective } from '../../components/format-appel';
import type { AppelDuJour } from '@/lib/accueil';

/**
 * Filtres et comptes des appels du jour. Les appels simulés sont à part : « Tous » ne les compte pas, le
 * filtre « Simulés » est exclusif. Chaque appel réel tombe dans une et une seule case (une des sept issues ou
 * « Sans bilan ») : la somme des cases fait « Tous ». Fonctions pures, testées.
 */

export type CleFiltre = IssueSysteme | 'sans-bilan';
export const CLES_FILTRE: readonly CleFiltre[] = [...ISSUES_SYSTEME, 'sans-bilan'];

type Classable = Pick<AppelDuJour, 'statut' | 'issue' | 'issueSysteme' | 'ligne'>;

/** La case d'un appel : son issue effective quand il a abouti, sinon « Sans bilan ». */
export function cleFiltre(a: Classable): CleFiltre {
  if (a.statut !== 'termine') return 'sans-bilan';
  return issueEffective(a) ?? 'sans-bilan';
}

export const estSimule = (a: Pick<AppelDuJour, 'ligne'>) => a.ligne === 'simulation';

export function comptesFiltres(appels: readonly Classable[]): { tous: number; simules: number; parCle: Record<CleFiltre, number> } {
  const parCle = Object.fromEntries(CLES_FILTRE.map((c) => [c, 0])) as Record<CleFiltre, number>;
  let tous = 0;
  let simules = 0;
  for (const a of appels) {
    if (estSimule(a)) {
      simules += 1;
      continue;
    }
    tous += 1;
    parCle[cleFiltre(a)] += 1;
  }
  return { tous, simules, parCle };
}

export interface EtatFiltres {
  issue: CleFiltre | null;
  simules: boolean;
}

/** Lit `?issue=` et `?simules=1` ; une valeur inconnue est ignorée. Simulés l'emporte (exclusif). */
export function lireFiltres(p: { issue?: string | null; simules?: string | null }): EtatFiltres {
  const simules = p.simules === '1';
  const issue = !simules && p.issue && (CLES_FILTRE as readonly string[]).includes(p.issue) ? (p.issue as CleFiltre) : null;
  return { issue, simules };
}

/** Minuscules sans accents, pour une recherche qui trouve « Gite » dans « Gîte ». */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr-FR');
}

/** Filtrage instantané, dans ce qui est déjà chargé : prospect, société, entreprise, résumé. */
export function correspond(a: Pick<AppelDuJour, 'prospect' | 'societe' | 'entreprise' | 'resume'>, texte: string): boolean {
  const q = normaliser(texte.trim());
  if (!q) return true;
  return [a.prospect, a.societe, a.entreprise, a.resume].some((champ) => champ && normaliser(champ).includes(q));
}

export function filtrerAppels<A extends Classable & Pick<AppelDuJour, 'id' | 'prospect' | 'societe' | 'entreprise' | 'resume'>>(
  appels: readonly A[],
  f: EtatFiltres & { texte: string; trouves: ReadonlySet<string> | null },
): A[] {
  return appels.filter((a) => {
    if (f.simules !== estSimule(a)) return false;
    if (f.issue && cleFiltre(a) !== f.issue) return false;
    // Recherche serveur appliquée : ses résultats (transcriptions comprises) font foi.
    if (f.trouves) return f.trouves.has(a.id);
    return correspond(a, f.texte);
  });
}

/** « 62 appels depuis 09:02 · 41 conversations · 4 rendez-vous » : appels réels seulement. */
export function bilanJournee(appels: readonly (Classable & Pick<AppelDuJour, 'debutLe'>)[]): {
  total: number;
  conversations: number;
  rendezVous: number;
  simules: number;
  premier: string | null;
} {
  let total = 0;
  let conversations = 0;
  let rendezVous = 0;
  let simules = 0;
  let premier: string | null = null;
  for (const a of appels) {
    if (estSimule(a)) {
      simules += 1;
      continue;
    }
    total += 1;
    if (!premier || Date.parse(a.debutLe) < Date.parse(premier)) premier = a.debutLe;
    const issue = a.statut === 'termine' ? issueEffective(a) : null;
    if (issue && issue !== 'non-abouti') conversations += 1;
    if (issue === 'rendez-vous-pris') rendezVous += 1;
  }
  return { total, conversations, rendezVous, simules, premier };
}
