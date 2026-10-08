/**
 * Ce que la page dit après un geste appliqué d'un coup (enregistré, poussé, commité : lib/edition-assistante.ts).
 * L'écriture a toujours eu lieu ; la poussée et le commit disent chacun leur raison s'ils n'ont pas suivi.
 */

type Resultat = { ok: true } | { ok: false; raison: string };
export type Application = {
  poussee: ({ ok: true; campagneEnCours: boolean } & object) | { ok: false; raison: string };
  commit: Resultat | null;
};

export function texteApplication(fait: string, a: Application): { ton: 'neutre' | 'alerte'; texte: string } {
  if (!a.poussee.ok) return { ton: 'alerte', texte: `${fait}, pas encore appliqué aux appels : ${a.poussee.raison} La section Poussée le reprend.` };
  const campagne = a.poussee.campagneEnCours ? ', campagne en cours comprise' : '';
  return { ton: 'neutre', texte: `${fait}. Appliqué : sert dès le prochain appel${campagne}. ${texteCommit(a.commit)}` };
}

export function texteCommit(commit: Resultat | null): string {
  if (!commit) return '';
  return commit.ok ? 'Commité dans git.' : `Pas commité dans git (${commit.raison}) : à faire à la main.`;
}
