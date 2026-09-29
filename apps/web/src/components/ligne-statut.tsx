'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useLigne, type EtatLigneClient } from './etat-ligne-telephone';

type Trait = 'pointille' | 'plein' | 'interrompu';

interface Affichage {
  trait: Trait;
  couleurTrait: string;
  couleurTexte: string;
  libelle: string;
  court: string;
  lien: { href: string; aria: string } | null;
}

const VERS_TELEPHONE = 'ouvrir la page Téléphone';

function affichage(e: EtatLigneClient): Affichage {
  switch (e.etat) {
    case 'releve':
      return { trait: 'pointille', couleurTrait: 'stroke-trait', couleurTexte: 'text-encre-3', libelle: 'Relevé de la ligne…', court: '…', lien: null };
    case 'libre':
      return {
        trait: 'pointille',
        couleurTrait: 'stroke-trait',
        couleurTexte: 'text-encre-3',
        libelle: 'Ligne libre',
        court: 'Libre',
        lien: { href: '/telephone', aria: `Ligne libre : ${VERS_TELEPHONE}` },
      };
    case 'en-appel':
      return e.ligne === 'telephone'
        ? {
            trait: 'plein',
            couleurTrait: 'stroke-antenne',
            couleurTexte: 'text-antenne',
            libelle: 'En appel · téléphone',
            court: 'En appel',
            // Sans identifiant d'appel (le pont ne l'a pas donné), la page Téléphone reste la bonne porte.
            lien: e.appelId
              ? { href: `/appels/${e.appelId}`, aria: 'En appel · téléphone : rejoindre l’appel en cours (suivi, écoute, prise de main)' }
              : { href: '/telephone', aria: `En appel · téléphone : ${VERS_TELEPHONE}` },
          }
        : { trait: 'plein', couleurTrait: 'stroke-antenne', couleurTexte: 'text-antenne', libelle: 'En appel · navigateur', court: 'En appel', lien: null };
    case 'deconnecte':
      return {
        trait: 'interrompu',
        couleurTrait: 'stroke-alerte',
        couleurTexte: 'text-alerte',
        libelle: 'Téléphone déconnecté',
        court: 'Déconnecté',
        lien: { href: '/telephone', aria: `Téléphone passerelle déconnecté : ${VERS_TELEPHONE}` },
      };
    case 'injoignable':
      return {
        trait: 'interrompu',
        couleurTrait: 'stroke-alerte',
        couleurTexte: 'text-alerte',
        libelle: 'Ligne injoignable',
        court: 'Injoignable',
        lien: { href: '/telephone', aria: `Ligne injoignable : la ligne téléphone ne répond pas, ${VERS_TELEPHONE}` },
      };
    case 'inconnu':
      return {
        trait: 'interrompu',
        couleurTrait: 'stroke-trait',
        couleurTexte: 'text-encre-3',
        libelle: 'État de la ligne inconnu',
        court: 'Inconnu',
        lien: { href: '/telephone', aria: `État de la ligne inconnu : ${VERS_TELEPHONE}` },
      };
  }
}

const TIRETS: Record<Trait, string | undefined> = { pointille: '2 4', plein: undefined, interrompu: '22 4 30' };

function TraitLigne({ largeur, trait, couleur, className }: { largeur: number; trait: Trait; couleur: string; className: string }) {
  const tirets = largeur < 56 && trait === 'interrompu' ? '6 3 7' : TIRETS[trait];
  return (
    <svg width={largeur} height="16" viewBox={`0 0 ${largeur} 16`} aria-hidden="true" className={`shrink-0 overflow-visible ${className}`}>
      <line
        x1="0"
        y1="8"
        x2={largeur}
        y2="8"
        strokeWidth="1.5"
        strokeLinecap={trait === 'pointille' ? 'round' : 'butt'}
        strokeDasharray={tirets}
        className={`transition-colors duration-300 ${couleur}`}
      />
    </svg>
  );
}

/**
 * État de la ligne, toujours visible dans la barre : un trait (pointillé au repos, plein en antenne pendant
 * un appel, interrompu quand la ligne n'est pas sûre) et un libellé. Relu toutes les 3 s par useLigne.
 * Plus jamais « Ligne libre » affirmé sans relevé.
 */
export function LigneStatut() {
  return <VueLigneStatut etat={useLigne()} />;
}

/** Rendu pur d'un état de ligne (démontrable sans pont). */
export function VueLigneStatut({ etat }: { etat: EtatLigneClient }) {
  const a = affichage(etat);
  const contenu = (
    <>
      <TraitLigne largeur={56} trait={a.trait} couleur={a.couleurTrait} className="hidden sm:block" />
      <TraitLigne largeur={16} trait={a.trait} couleur={a.couleurTrait} className="sm:hidden" />
      <span className={`libelle text-sm whitespace-nowrap ${a.couleurTexte}`}>
        <span className="hidden sm:inline">{a.libelle}</span>
        <span className="sm:hidden">{a.court}</span>
      </span>
    </>
  );
  return (
    <div role="status" aria-live="polite" className="flex items-center">
      {a.lien ? (
        <Link
          href={a.lien.href}
          aria-label={a.lien.aria}
          className="-mx-1.5 flex h-9 items-center gap-2.5 rounded-[4px] px-1.5 hover:[&_.libelle]:underline [&_.libelle]:decoration-souligne [&_.libelle]:underline-offset-4 pointer-coarse:h-11"
        >
          {contenu}
        </Link>
      ) : (
        <div className="flex h-9 items-center gap-2.5">{contenu}</div>
      )}
    </div>
  );
}

const PREFIXE = 'En appel · ';

/**
 * Sans rendu : préfixe le titre de l'onglet par « En appel · » pendant un appel. Next remplace le titre à
 * chaque navigation : un observateur de <head> le repose.
 */
export function TitreEnAppel() {
  const enAppel = useLigne().etat === 'en-appel';
  useEffect(() => {
    if (!enAppel) return;
    const poser = () => {
      if (!document.title.startsWith(PREFIXE)) document.title = PREFIXE + document.title;
    };
    poser();
    const observateur = new MutationObserver(poser);
    observateur.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observateur.disconnect();
      if (document.title.startsWith(PREFIXE)) document.title = document.title.slice(PREFIXE.length);
    };
  }, [enAppel]);
  return null;
}
