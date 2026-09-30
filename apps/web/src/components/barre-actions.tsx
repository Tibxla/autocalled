/**
 * Barre d'actions collée en bas, pour un formulaire long dont l'action de soumission sortirait de l'écran (fiche
 * entreprise, éditeur de version, objection, nouvelle campagne, ajout à la file). Un formulaire court n'en a pas :
 * son action suit le dernier champ.
 *
 * - Une seule action en relief, la soumission (ton fort) ; les autres actions en texte. `children` est la rangée
 *   d'actions, posée telle quelle : l'appelant garde ses retraits (`-ml-1.5`), que le relief annule au doigt.
 * - `statut` sur une ligne, tronqué (« Non enregistré »), dans une région `role="status"` toujours présente. Une
 *   seule colonne bornée (`grid-cols-1`) : sans elle, le statut non coupé élargirait la barre au-delà de l'écran.
 *   En fenêtre étroite, statut et actions passent à la ligne plutôt que de déborder.
 * - `messages` (champs à corriger, conflit, erreur) au-dessus de la rangée d'actions.
 * - Une confirmation ouverte depuis la barre remplace la rangée d'actions tant qu'elle est ouverte : l'appelant
 *   la passe en `children` à la place des actions.
 * - 60 px au plus sans message tant que la rangée tient sur une ligne (deux lignes en fenêtre étroite). Elle se
 *   pose au-dessus de la barre du bas (`--hauteur-nav-bas`) et, en fin de défilement, s'arrête juste au-dessus
 *   d'elle sans rien recouvrir (marge basse négative qui mange `--fin-de-page`). Clavier de l'écran ouvert, la barre du bas s'efface et celle-ci descend tout en bas.
 * - Le formulaire qui la contient fait remonter le champ au focus au-dessus d'elle (règle `form:has(.barre-actions)`
 *   de globals.css). `self-end` : dans une grille, elle garde la hauteur de son contenu.
 */
export function BarreActions({
  children,
  statut,
  messages,
  className = '',
}: {
  children: React.ReactNode;
  statut?: React.ReactNode;
  messages?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`barre-actions sticky bottom-(--hauteur-nav-bas) z-10 -mx-(--gouttiere) mb-[calc(var(--hauteur-nav-bas)_-_var(--fin-de-page))] grid grid-cols-1 gap-2 self-end border-t border-filet bg-fond px-(--gouttiere) py-2 sm:py-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] ${className}`}
    >
      {messages ? <div className="grid gap-2">{messages}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{children}</div>
        {/* Toujours rendue, même vide : une région d'état qui apparaît avec son texte n'est pas toujours annoncée. */}
        <p role="status" className="ml-auto min-w-0 truncate text-sm">
          {statut}
        </p>
      </div>
    </div>
  );
}
