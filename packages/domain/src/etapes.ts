/** Une étape de script telle qu'une version la fige : une intention et quelques formulations d'exemple. */
export interface EtapeScript {
  intention: string;
  exemples: string[];
}

function normaliser(etapes: readonly EtapeScript[]): string[][] {
  return etapes.map((e) => [e.intention.trim(), ...e.exemples.map((x) => x.trim()).filter(Boolean)]);
}

/**
 * Deux listes d'étapes disent-elles la même chose, aux espaces et aux exemples vides près ? Une nouvelle
 * version identique à la précédente n'apprendrait rien à l'analyse : elle est refusée.
 */
export function etapesIdentiques(a: readonly EtapeScript[], b: readonly EtapeScript[]): boolean {
  return JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b));
}
