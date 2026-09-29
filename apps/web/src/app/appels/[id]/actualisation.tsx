'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { duree } from '@/components/format-appel';
import { useHorloge } from '@/components/horloge';

/**
 * Relit la page à intervalle régulier tant qu'un état doit bouger (analyse, simulation, appel suivi).
 * `siVisible` (défaut vrai) : rien tant que l'onglet est caché, une relecture immédiate au retour.
 * `dureeMaxSecondes` : au-delà, une dernière relecture puis plus rien (la page dit alors ce qui coince).
 */
export function Actualisation({
  secondes = 3,
  dureeMaxSecondes,
  siVisible = true,
}: {
  secondes?: number;
  dureeMaxSecondes?: number;
  siVisible?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    const debut = Date.now();
    let finie = false;
    const relire = () => {
      if (finie) return;
      if (dureeMaxSecondes !== undefined && Date.now() - debut > dureeMaxSecondes * 1000) {
        finie = true;
        clearInterval(minuterie);
        router.refresh();
        return;
      }
      if (siVisible && document.hidden) return;
      router.refresh();
    };
    const minuterie = setInterval(relire, secondes * 1000);
    const auRetour = () => {
      if (!document.hidden) relire();
    };
    if (siVisible) document.addEventListener('visibilitychange', auRetour);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [router, secondes, dureeMaxSecondes, siVisible]);
  return null;
}

/** Temps écoulé depuis `depuis` (ISO), en m:ss, à la seconde ; rien avant le montage. */
export function Ecoule({ depuis }: { depuis: string }) {
  const maintenant = useHorloge();
  const ms = maintenant > 0 ? maintenant - Date.parse(depuis) : 0;
  return <span className="font-mono">{maintenant > 0 ? duree(Math.max(1, ms / 1000)) : '0:00'}</span>;
}
