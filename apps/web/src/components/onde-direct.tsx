'use client';

import { useEffect, useRef } from 'react';

const PAS = 5;
const LARGEUR = 2;

/**
 * L'onde de la ligne navigateur : les deux voix de l'appel en direct, tirées des fréquences réelles des deux
 * flux audio. Mina en antenne au-dessus de l'axe, le prospect en encre-3 dessous. 40 px de haut, redessinée à
 * chaque changement de taille. `niveau` (optionnel) : une piste unique, voix mélangées, défilant de droite à
 * gauche. Mouvement réduit : l'axe seul, le libellé de la bande porte l'information.
 */
export function OndeDirect({
  entree,
  sortie,
  actif,
  niveau,
  hauteur = 40,
}: {
  entree: () => Uint8Array;
  sortie: () => Uint8Array;
  actif: boolean;
  niveau?: () => number;
  hauteur?: number;
}) {
  const toile = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = toile.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(document.documentElement);
    const rouge = style.getPropertyValue('--antenne').trim();
    const encre = style.getPropertyValue('--encre-3').trim();
    const axe = style.getPropertyValue('--filet-2').trim();
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const historique: number[] = [];
    let image = 0;

    const moyenne = (donnees: Uint8Array, debut: number, fin: number) => {
      let total = 0;
      for (let i = debut; i < fin; i++) total += donnees[i] ?? 0;
      return total / Math.max(1, fin - debut) / 255;
    };

    const dimensionner = () => {
      const ratio = devicePixelRatio || 1;
      const { clientWidth: l, clientHeight: h } = canvas;
      if (canvas.width !== Math.round(l * ratio) || canvas.height !== Math.round(h * ratio)) {
        canvas.width = Math.round(l * ratio);
        canvas.height = Math.round(h * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      return { l, h };
    };

    const dessiner = () => {
      const { l, h } = dimensionner();
      ctx.clearRect(0, 0, l, h);
      const milieu = h / 2;
      ctx.fillStyle = axe;
      ctx.fillRect(0, milieu - 0.5, l, 1);

      if (actif && !reduit) {
        const barres = Math.floor(l / PAS);
        if (niveau) {
          historique.push(Math.min(1, niveau() * 4));
          while (historique.length > barres) historique.shift();
          ctx.fillStyle = encre;
          historique.forEach((v, i) => {
            const demi = v * (milieu - 2);
            if (demi > 0.5) ctx.fillRect(l - (historique.length - i) * PAS, milieu - demi, LARGEUR, demi * 2);
          });
        } else {
          const voixMina = sortie();
          const voixProspect = entree();
          for (let i = 0; i < barres; i++) {
            const a = Math.floor((i / barres) * voixMina.length * 0.7);
            const b = Math.floor(((i + 1) / barres) * voixMina.length * 0.7);
            const haut = moyenne(voixMina, a, b) * (milieu - 2);
            const bas = moyenne(voixProspect, a, b) * (milieu - 2);
            const x = i * PAS + 1;
            if (haut > 0.5) {
              ctx.fillStyle = rouge;
              ctx.fillRect(x, milieu - 1 - haut, LARGEUR, haut);
            }
            if (bas > 0.5) {
              ctx.fillStyle = encre;
              ctx.fillRect(x, milieu + 1, LARGEUR, bas);
            }
          }
        }
      }
      if (actif && !reduit) image = requestAnimationFrame(dessiner);
    };

    dessiner();
    // Au repos ou en mouvement réduit, rien ne boucle : on redessine seulement quand la taille change.
    const observateur = new ResizeObserver(() => {
      if (!actif || reduit) dessiner();
    });
    observateur.observe(canvas);
    return () => {
      cancelAnimationFrame(image);
      observateur.disconnect();
    };
  }, [actif, entree, sortie, niveau]);

  return <canvas ref={toile} aria-hidden="true" className="block w-full max-sm:h-8!" style={{ height: hauteur }} />;
}
