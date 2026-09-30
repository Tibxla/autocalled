'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useLigne, type CampagneLigne, type EtatLigneClient } from './etat-ligne-telephone';
import { chrono, heure } from './format-appel';
import { useHorloge } from './horloge';

export type Trait = 'pointille' | 'plein' | 'interrompu';

export interface AffichageLigne {
  trait: Trait;
  couleurTrait: string;
  couleurTexte: string;
  libelle: string;
  court: string;
  lien: { href: string; aria: string } | null;
}

const VERS_TELEPHONE = 'ouvrir la page Téléphone';

/** Ce que la barre montre d'un état de ligne : forme et couleur du trait, libellés long et court, lien. */
export function affichageLigne(e: EtatLigneClient): AffichageLigne {
  switch (e.etat) {
    case 'releve':
      return { trait: 'pointille', couleurTrait: 'stroke-trait', couleurTexte: 'text-encre-3', libelle: 'Relevé de la ligne…', court: '…', lien: null };
    case 'libre':
      if (e.plafond) {
        const prochain = e.plafond.jusqua ? ` · prochain appel à ${heure(new Date(e.plafond.jusqua))}` : '';
        return {
          trait: 'pointille',
          couleurTrait: 'stroke-trait',
          couleurTexte: 'text-encre-2',
          libelle: `Plafond atteint${prochain}`,
          court: 'Plafond',
          lien: { href: '/telephone', aria: `Plafond d’appels atteint${prochain.replace(' · ', ', ')} : ${VERS_TELEPHONE}` },
        };
      }
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
        couleurTexte: 'text-encre-2',
        libelle: 'Téléphone déconnecté',
        court: 'Déconnecté',
        lien: { href: '/telephone', aria: `Téléphone passerelle déconnecté : ${VERS_TELEPHONE}` },
      };
    case 'injoignable':
      return {
        trait: 'interrompu',
        couleurTrait: 'stroke-alerte',
        couleurTexte: 'text-encre-2',
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

/** Interrompu : une coupure franche au milieu (10 px sur 56, 5 px sur 16), qui ne se confond pas avec le plein d'un appel. */
const TIRETS: Record<Trait, string | undefined> = { pointille: '2 4', plein: undefined, interrompu: '20 10 26' };

/** Le trait de la ligne d'état (56 px dans la barre, 16 px sur mobile et au-dessus de « Téléphone » dans la barre du bas). */
export function TraitLigne({ largeur, trait, couleur, className = '' }: { largeur: number; trait: Trait; couleur: string; className?: string }) {
  const tirets = largeur < 56 && trait === 'interrompu' ? '5 5 6' : TIRETS[trait];
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
 * un appel, coupé en brique quand la ligne est tombée, coupé en graphite quand son état est inconnu) et un
 * libellé, graphite hors appel. Relu toutes les 3 s par useLigne.
 * Plus jamais « Ligne libre » affirmé sans relevé.
 */
export function LigneStatut() {
  const etat = useLigne();
  const decrocheLe = etat.etat === 'en-appel' && etat.ligne === 'telephone' ? (etat.decrocheLe ?? null) : null;
  const maintenant = useHorloge(decrocheLe !== null);
  return <VueLigneStatut etat={etat} maintenant={maintenant} />;
}

/**
 * Rendu pur d'un état de ligne (démontrable sans pont). `maintenant` (0 avant le montage) fait battre le chrono
 * d'un appel téléphone depuis son décroché : il sort de la région vivante, qui n'annoncerait sinon que lui.
 */
export function VueLigneStatut({ etat, maintenant = 0 }: { etat: EtatLigneClient; maintenant?: number }) {
  const a = affichageLigne(etat);
  const decrocheLe = etat.etat === 'en-appel' && etat.ligne === 'telephone' ? (etat.decrocheLe ?? null) : null;
  // Sous 640 px, le chrono tient lieu de libellé : trait et chrono, en antenne, disent l'appel, et la campagne
  // garde sa place à côté. Il prend alors le soulignement du libellé au doigt.
  const avecChrono = decrocheLe !== null && maintenant > 0;
  const contenu = (
    <>
      <TraitLigne largeur={56} trait={a.trait} couleur={a.couleurTrait} className="hidden sm:block" />
      <TraitLigne largeur={16} trait={a.trait} couleur={a.couleurTrait} className="sm:hidden" />
      <span className={`libelle text-sm whitespace-nowrap ${a.couleurTexte} ${avecChrono ? 'max-sm:hidden' : ''}`}>
        <span className="hidden sm:inline">{a.libelle}</span>
        <span className="sm:hidden">{a.court}</span>
      </span>
      {avecChrono ? (
        <span
          aria-hidden="true"
          className="font-mono text-sm text-antenne max-sm:decoration-souligne max-sm:underline-offset-4 max-sm:pointer-coarse:underline"
        >
          {chrono(Math.max(0, maintenant - (decrocheLe ?? 0)))}
        </span>
      ) : null}
    </>
  );
  return (
    <div role="status" aria-live="polite" className="flex shrink-0 items-center">
      {a.lien ? (
        <Link
          href={a.lien.href}
          aria-label={a.lien.aria}
          className="-mx-1.5 flex h-9 items-center gap-2.5 rounded-[4px] px-1.5 hover:[&_.libelle]:underline [&_.libelle]:decoration-souligne [&_.libelle]:underline-offset-4 pointer-coarse:h-11 pointer-coarse:[&_.libelle]:underline pointer-coarse:active:bg-survol"
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

/**
 * La campagne qui tourne ou attend, vue de toute page : « Campagne Gîtes · 34/100 » ou « · suspendue », lien
 * vers sa régie. Rien sans campagne ouverte. De 640 à 1280 px, où la barre n’a pas la place du nom, seul le
 * compte reste (« 12/14 ») ; sous 640 px, où la navigation est descendue, « Campagne 12/14 », et le compte seul
 * sous 400 px, où il ne tiendrait pas à côté de l'état de la ligne. S'il déborde encore, il se coupe plutôt que de
 * chevaucher l'état de la ligne, qui ne rétrécit pas. 44 px au doigt.
 */
export function CampagneStatut() {
  return <VueCampagneStatut campagne={useLigne().campagne} />;
}

export function VueCampagneStatut({ campagne: c }: { campagne: CampagneLigne | null }) {
  if (!c) return null;
  const suspendue = c.statut === 'en-pause';
  return (
    <Link
      href={`/campagnes/${c.id}`}
      aria-label={`Campagne ${c.entreprise}, ${suspendue ? 'suspendue' : 'en cours'}, ${c.traites} traités sur ${c.total} : ouvrir sa régie`}
      className="-mx-1.5 flex h-9 max-w-[18rem] min-w-0 items-center gap-1 overflow-hidden rounded-[4px] px-1.5 text-sm whitespace-nowrap text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline pointer-coarse:h-11 pointer-coarse:underline pointer-coarse:active:bg-survol"
    >
      <span className="shrink-0 sm:hidden max-[25rem]:hidden">Campagne</span>
      <span className="hidden truncate xl:inline">Campagne {c.entreprise}</span>
      <span className="hidden shrink-0 xl:inline">·</span>
      {suspendue ? (
        <span className="shrink-0">suspendue</span>
      ) : (
        <span className="shrink-0 font-mono text-encre-2">
          {c.traites}/{c.total}
        </span>
      )}
    </Link>
  );
}
