/**
 * Classes des actions, sans directive : une page rendue côté serveur peut appeler `classesAction` pour un `<a href>`
 * écrit à la main. action.tsx (module client) en tire ses composants ; ui.tsx réexporte `classesAction` d'ici.
 */

export type TonAction = 'fort' | 'normal' | 'discret' | 'alerte';
export type FormeAction = 'relief' | 'texte';

const BASE =
  'group inline-flex h-9 items-center gap-2 rounded-[4px] px-1.5 text-left text-md whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 pointer-coarse:h-11 pointer-coarse:min-w-11';

const TONS: Record<TonAction, string> = {
  fort: 'font-semibold text-encre',
  normal: 'font-medium text-encre-2 hover:text-encre',
  discret: 'text-encre-3 hover:text-encre-2',
  alerte: 'font-medium text-alerte',
};

/** Forme texte au doigt : l'appui se voit par le voile de ligne (le soulignement est porté par le libellé). */
const TEXTE = 'pointer-coarse:active:bg-survol';

/**
 * Forme relief au doigt : le cadre d'un pixel et le bord bas appuyé de la touche, agrandis. Appuyée, le bord bas
 * s'efface et le fond passe en filet-2 : la touche paraît enfoncée, sans mouvement. `mx-0` annule le retrait
 * négatif qu'un appelant pose pour aligner le texte sur la colonne.
 */
const RELIEF_COMMUN = 'pointer-coarse:mx-0 pointer-coarse:px-4 pointer-coarse:justify-center';
const RELIEF: Record<Exclude<TonAction, 'discret'>, string> = {
  fort: 'pointer-coarse:bg-surface pointer-coarse:shadow-[inset_0_0_0_1px_var(--trait),inset_0_-1px_0_var(--trait)] pointer-coarse:active:bg-filet-2 pointer-coarse:active:shadow-[inset_0_0_0_1px_var(--trait)]',
  normal:
    'pointer-coarse:bg-surface pointer-coarse:shadow-[inset_0_0_0_1px_var(--filet-fort),inset_0_-1px_0_var(--filet-fort)] pointer-coarse:active:bg-filet-2 pointer-coarse:active:shadow-[inset_0_0_0_1px_var(--filet-fort)]',
  alerte:
    'pointer-coarse:bg-alerte-fond pointer-coarse:shadow-[inset_0_0_0_1px_var(--alerte),inset_0_-1px_0_var(--alerte)] pointer-coarse:active:shadow-[inset_0_0_0_1px_var(--alerte)]',
};

export function formeDe(ton: TonAction, forme: FormeAction | undefined): FormeAction {
  if (ton === 'discret') return 'texte';
  return forme ?? (ton === 'fort' ? 'relief' : 'texte');
}

export function classesElement(ton: TonAction, forme: FormeAction): string {
  const doigt = forme === 'relief' && ton !== 'discret' ? `${RELIEF_COMMUN} ${RELIEF[ton]}` : TEXTE;
  return `${BASE} ${TONS[ton]} ${doigt}`;
}

/** Soulignement du libellé : au survol partout, en permanence au doigt pour la forme texte. */
export const SOULIGNE = 'decoration-souligne decoration-1 underline-offset-4 group-hover:underline group-disabled:no-underline group-aria-disabled:no-underline';
export const SOULIGNE_TEXTE = `${SOULIGNE} pointer-coarse:underline`;

/**
 * Les classes d'une action pour un élément écrit à la main, sans libellé intérieur : un `<a href>` externe
 * (« Ouvrir la visio ») ou un `<summary>`. Le soulignement de la forme texte est posé sur l'élément lui-même.
 */
export function classesAction(ton: TonAction, forme?: FormeAction): string {
  const f = formeDe(ton, forme);
  const soulignement =
    f === 'texte'
      ? 'decoration-souligne decoration-1 underline-offset-4 hover:underline pointer-coarse:underline disabled:no-underline aria-disabled:no-underline'
      : 'decoration-souligne decoration-1 underline-offset-4 hover:underline pointer-coarse:no-underline';
  return `${classesElement(ton, f)} ${soulignement}`;
}
