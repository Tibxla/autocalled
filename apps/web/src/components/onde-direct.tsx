'use client';

import { useEffect, useRef } from 'react';
import type { VueNiveaux } from './niveaux-direct';

const PAS = 5;
const LARGEUR = 2;

/**
 * L'onde des deux voix de l'appel en direct : Mina en antenne au-dessus de l'axe, le prospect en encre-3 dessous.
 * 40 px de haut, redessinée à chaque changement de taille. Trois sources, par ordre de priorité :
 * - `niveau` : une piste unique, voix mélangées, défilant de droite à gauche ;
 * - `niveaux` : les niveaux des deux voix relayés par le pont (ligne téléphone), défilant de droite à gauche au
 *   rythme du temps, une barre par relevé ;
 * - `entree` et `sortie` : les fréquences réelles des deux flux audio (ligne navigateur).
 * Mouvement réduit : l'axe seul, le libellé de la bande porte l'information.
 */
export function OndeDirect({
  entree,
  sortie,
  actif,
  niveau,
  niveaux,
  hauteur = 40,
}: {
  entree?: () => Uint8Array;
  sortie?: () => Uint8Array;
  actif: boolean;
  niveau?: () => number;
  niveaux?: { vue: (maintenant: number, cases: number) => VueNiveaux } | null;
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

    /** Une barre : Mina de `haut` px au-dessus de l'axe, le prospect de `bas` px dessous. */
    const barre = (x: number, milieu: number, haut: number, bas: number) => {
      if (haut > 0.5) {
        ctx.fillStyle = rouge;
        ctx.fillRect(x, milieu - 1 - haut, LARGEUR, haut);
      }
      if (bas > 0.5) {
        ctx.fillStyle = encre;
        ctx.fillRect(x, milieu + 1, LARGEUR, bas);
      }
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
        } else if (niveaux) {
          // Une case par relevé ; la plus récente entre par la droite et glisse d'un pas jusqu'au relevé suivant.
          const cases = barres + 2;
          const { mina, prospect, glisse } = niveaux.vue(Date.now(), cases);
          for (let k = 0; k < cases; k++) {
            const x = l - (cases - k + glisse) * PAS;
            if (x + LARGEUR > 0) barre(x, milieu, (mina[k] ?? 0) * (milieu - 2), (prospect[k] ?? 0) * (milieu - 2));
          }
        } else if (entree && sortie) {
          const voixMina = sortie();
          const voixProspect = entree();
          for (let i = 0; i < barres; i++) {
            const a = Math.floor((i / barres) * voixMina.length * 0.7);
            const b = Math.floor(((i + 1) / barres) * voixMina.length * 0.7);
            barre(i * PAS + 1, milieu, moyenne(voixMina, a, b) * (milieu - 2), moyenne(voixProspect, a, b) * (milieu - 2));
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
  }, [actif, entree, sortie, niveau, niveaux]);

  return <canvas ref={toile} aria-hidden="true" className="block w-full max-sm:h-8!" style={{ height: hauteur }} />;
}
