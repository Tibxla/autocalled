import type { IssueSysteme } from './issues.ts';

/**
 * Comparaison des versions de script d'une entreprise. Les appels non aboutis ne disent rien du
 * script : ils sont comptés mais exclus des taux. Sous le seuil, aucune version n'est déclarée meilleure.
 */
export const SEUIL_ECHANTILLON = 10;

export interface AppelAnalyse {
  versionScriptId: string;
  issueSysteme: IssueSysteme;
  etapeAtteinte: number;
  objections: { objectionId: string | null; levee: boolean; tempsBloquant: string | null }[];
}

export interface StatistiquesVersion {
  versionScriptId: string;
  appels: number;
  conversations: number;
  rendezVous: number;
  tauxRendezVous: number | null;
  etapeMedianeSansRendezVous: number | null;
  echantillonSuffisant: boolean;
}

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? (triees[milieu] ?? null) : ((triees[milieu - 1] ?? 0) + (triees[milieu] ?? 0)) / 2;
}

export function statistiquesParVersion(appels: readonly AppelAnalyse[]): StatistiquesVersion[] {
  const parVersion = Map.groupBy(appels, (a) => a.versionScriptId);
  return [...parVersion].map(([versionScriptId, liste]) => {
    const conversations = liste.filter((a) => a.issueSysteme !== 'non-abouti');
    const rendezVous = conversations.filter((a) => a.issueSysteme === 'rendez-vous-pris').length;
    return {
      versionScriptId,
      appels: liste.length,
      conversations: conversations.length,
      rendezVous,
      tauxRendezVous: conversations.length ? rendezVous / conversations.length : null,
      etapeMedianeSansRendezVous: mediane(
        conversations.filter((a) => a.issueSysteme !== 'rendez-vous-pris').map((a) => a.etapeAtteinte),
      ),
      echantillonSuffisant: conversations.length >= SEUIL_ECHANTILLON,
    };
  });
}

export interface StatistiquesObjection {
  objectionId: string | null;
  apparitions: number;
  levees: number;
  tempsBloquantPrincipal: string | null;
}

/** Par objection répertoriée ; les objections nouvelles sont regroupées sous `objectionId: null`. */
export function statistiquesObjections(appels: readonly AppelAnalyse[]): StatistiquesObjection[] {
  const toutes = appels.flatMap((a) => a.objections);
  return [...Map.groupBy(toutes, (o) => o.objectionId)]
    .map(([objectionId, liste]) => {
      const blocages = Map.groupBy(
        liste.filter((o) => !o.levee && o.tempsBloquant),
        (o) => o.tempsBloquant,
      );
      const principal = [...blocages].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? null;
      return { objectionId, apparitions: liste.length, levees: liste.filter((o) => o.levee).length, tempsBloquantPrincipal: principal };
    })
    .sort((a, b) => b.apparitions - a.apparitions);
}
