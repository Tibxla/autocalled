'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useEtatLigne } from '@/lib/etat-ligne';
import { inscrireGardeNavigation } from './clavier';
import { Confirmation, useConfirmation } from './confirmation';

/**
 * Pendant un appel sur la ligne navigateur, la conversation vit dans la page : la quitter coupe l'appel.
 * Un clic sur un lien interne vers une autre page est retenu (capture, avant le Link de Next qui s'arrête
 * sur un clic déjà annulé) et une confirmation s'ouvre sous la barre. Fermer l'onglet déclenche l'alerte
 * du navigateur. Les séquences clavier « g puis… » passent par la même confirmation. L'appel téléphone
 * n'est pas concerné : il vit dans le pont.
 */
export function GardeSortie() {
  const router = useRouter();
  const enAppel = useEtatLigne() === 'en-appel';
  const [cible, setCible] = useState<string | null>(null);
  const { ouverte, ouvrir, fermer } = useConfirmation();

  useEffect(() => {
    if (!enAppel) return;
    const clic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const lien = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!lien || lien.getAttribute('target') || lien.hasAttribute('download')) return;
      const url = new URL(lien.getAttribute('href') ?? '', location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      e.preventDefault();
      setCible(`${url.pathname}${url.search}${url.hash}`);
      ouvrir(lien instanceof HTMLElement ? lien : null);
    };
    const avantDepart = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener('click', clic, true);
    window.addEventListener('beforeunload', avantDepart);
    const retirerGarde = inscrireGardeNavigation((destination) => {
      setCible(destination);
      ouvrir(null);
    });
    return () => {
      document.removeEventListener('click', clic, true);
      window.removeEventListener('beforeunload', avantDepart);
      retirerGarde();
    };
  }, [enAppel, ouvrir]);

  if (!enAppel || !cible) return null;
  return (
    <div className="fixed inset-x-(--gouttiere) top-[calc(var(--hauteur-barre)+8px)] z-40 sm:left-auto sm:w-[28rem]">
      <Confirmation
        ouverte={ouverte}
        question="Quitter cette page coupe l’appel navigateur en cours."
        libelleConfirmer="Quitter quand même"
        libelleAnnuler="Rester"
        ton="alerte"
        className="border border-filet-2"
        onConfirmer={() => {
          const destination = cible;
          setCible(null);
          fermer();
          router.push(destination);
        }}
        onAnnuler={() => {
          setCible(null);
          fermer();
        }}
      />
    </div>
  );
}
