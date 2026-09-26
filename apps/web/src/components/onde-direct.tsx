'use client';

import { useEffect, useRef } from 'react';

/**
 * L'élément signature : les deux voix de l'appel en direct. Mina en rouge antenne au-dessus de la
 * ligne, le prospect en encre au-dessous. Dessiné à partir des fréquences audio des deux flux.
 */
export function OndeDirect({
  entree,
  sortie,
  actif,
}: {
  entree: () => Uint8Array;
  sortie: () => Uint8Array;
  actif: boolean;
}) {
  const toile = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = toile.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(document.documentElement);
    const rouge = style.getPropertyValue('--antenne').trim();
    const encre = style.getPropertyValue('--encre').trim();
    const filet = style.getPropertyValue('--filet-fort').trim();
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let image = 0;

    const moyenne = (donnees: Uint8Array, debut: number, fin: number) => {
      let total = 0;
      for (let i = debut; i < fin; i++) total += donnees[i] ?? 0;
      return total / Math.max(1, fin - debut) / 255;
    };

    const dessiner = () => {
      const ratio = devicePixelRatio || 1;
      const { clientWidth: l, clientHeight: h } = canvas;
      if (canvas.width !== l * ratio) {
        canvas.width = l * ratio;
        canvas.height = h * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, l, h);
      const milieu = h / 2;
      ctx.fillStyle = filet;
      ctx.fillRect(0, milieu - 0.5, l, 1);

      if (actif) {
        const voixMina = sortie();
        const voixProspect = entree();
        const barres = Math.floor(l / 5);
        for (let i = 0; i < barres; i++) {
          const a = Math.floor((i / barres) * voixMina.length * 0.7);
          const b = Math.floor(((i + 1) / barres) * voixMina.length * 0.7);
          const haut = moyenne(voixMina, a, b) * (milieu - 4);
          const bas = moyenne(voixProspect, a, b) * (milieu - 4);
          const x = i * 5 + 1;
          if (haut > 0.5) {
            ctx.fillStyle = rouge;
            ctx.fillRect(x, milieu - 1 - haut, 2, haut);
          }
          if (bas > 0.5) {
            ctx.fillStyle = encre;
            ctx.fillRect(x, milieu + 1, 2, bas);
          }
        }
      }
      if (!reduit) image = requestAnimationFrame(dessiner);
    };
    dessiner();
    return () => cancelAnimationFrame(image);
  }, [actif, entree, sortie]);

  return <canvas ref={toile} aria-hidden="true" className="h-24 w-full" />;
}
