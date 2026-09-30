'use client';

import { ActionReconnecter } from '@/app/telephone/panneau-telephone';
import { AIDE_RECONNEXION, reconnexionAppel } from '@/app/telephone/reconnexion';
import { useLigne } from '@/components/etat-ligne-telephone';

/**
 * Sous le message d'un appel téléphone qui n'est pas parti faute de téléphone : « Reconnecter le téléphone », le geste
 * de secours (en relief au doigt), et son aide. Une seule fois à l'écran ; jamais ligne injoignable, pendant un appel
 * ni avant le premier relevé de la ligne par le navigateur (reconnexion.ts).
 */
export function ReconnexionAppel({ appel }: { appel: { ligne: string; statut: string; conversation: boolean; erreur: string | null } }) {
  const { etat } = useLigne();
  if (!reconnexionAppel(appel, etat)) return null;
  return (
    <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pointer-coarse:mx-0">
      <ActionReconnecter ton="fort" aide={AIDE_RECONNEXION} />
    </div>
  );
}
