/**
 * Une touche du clavier affichée devant le libellé d'une action (« E Écouter », « Espace Prendre la main »).
 * Décorative dans une action : le nom accessible reste le libellé, la touche passe par aria-keyshortcuts.
 * Masquée au toucher : elle n'y veut rien dire. Les noms s'écrivent en toutes lettres (Entrée, Échap,
 * Espace, Ctrl, Maj) : la police ne contient ni ←, ni →, ni ↵.
 */
export function Touche({
  children,
  forte = false,
  decorative = false,
  className = '',
}: {
  children: React.ReactNode;
  forte?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden={decorative || undefined}
      className={`touche inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[3px] px-[5px] font-mono text-2xs leading-[18px] font-normal pointer-coarse:hidden ${
        forte
          ? 'text-encre shadow-[inset_0_0_0_1px_var(--trait),inset_0_-1px_0_var(--trait)]'
          : 'text-encre-3 shadow-[inset_0_0_0_1px_var(--filet-fort),inset_0_-1px_0_var(--filet-fort)]'
      } ${className}`}
    >
      {children}
    </kbd>
  );
}

/** Plusieurs touches d'une combinaison (« Ctrl Entrée ») côte à côte ; « Espace » reste une seule touche. */
export function Touches({ touche, forte, decorative = true }: { touche: string; forte?: boolean; decorative?: boolean }) {
  const parties = touche.split(' ').filter(Boolean);
  if (parties.length === 1) {
    return (
      <Touche forte={forte ?? false} decorative={decorative}>
        {touche}
      </Touche>
    );
  }
  return (
    <span aria-hidden={decorative || undefined} className="inline-flex gap-0.5 pointer-coarse:hidden">
      {parties.map((p) => (
        <Touche key={p} forte={forte ?? false}>
          {p}
        </Touche>
      ))}
    </span>
  );
}
