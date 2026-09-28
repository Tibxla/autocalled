'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useEtatLigne } from '@/lib/etat-ligne';

type EtatTelephone = { pont: boolean; connecte?: boolean; appelEnCours?: boolean; appelId?: string | null };

/** État de la ligne téléphone, relu toutes les 3 s (onglet visible) : il survit à un rechargement de la page. */
function useEtatTelephone(): EtatTelephone | null {
  const [etat, setEtat] = useState<EtatTelephone | null>(null);
  useEffect(() => {
    let actif = true;
    const lire = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/ligne/etat', { cache: 'no-store' });
        if (actif && r.ok) setEtat((await r.json()) as EtatTelephone);
      } catch {
        // réseau coupé : on garde le dernier état connu
      }
    };
    void lire();
    const minuterie = setInterval(lire, 3000);
    document.addEventListener('visibilitychange', lire);
    return () => {
      actif = false;
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', lire);
    };
  }, []);
  return etat;
}

/**
 * État de la ligne, toujours visible. Trait pointillé au repos ; rouge « antenne » pendant un appel. Un appel
 * téléphone en cours est un lien vers sa page (suivi, écoute, prise de main) ; un appel dans le navigateur
 * n'est connu que de la page qui le porte.
 */
export function LigneStatut() {
  const navigateur = useEtatLigne() === 'en-appel';
  const telephone = useEtatTelephone();
  const appelTelephone = telephone?.appelEnCours ? telephone.appelId : null;
  const vivant = navigateur || Boolean(telephone?.appelEnCours);
  const libelle = navigateur
    ? 'En appel'
    : appelTelephone || telephone?.appelEnCours
      ? 'En appel · téléphone'
      : telephone && !telephone.pont
        ? 'Pont arrêté'
        : telephone && !telephone.connecte
          ? 'Téléphone déconnecté'
          : 'Ligne libre';

  const contenu = (
    <>
      <span aria-hidden="true" className={`size-1.5 rounded-full sm:hidden ${vivant ? 'bg-antenne' : 'bg-filet-fort'}`} />
      <svg width="56" height="16" viewBox="0 0 56 16" aria-hidden="true" className="hidden overflow-visible sm:block">
        <line
          x1="0"
          y1="8"
          x2="56"
          y2="8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={vivant ? undefined : '2 4'}
          className={`transition-colors duration-300 ${vivant ? 'stroke-antenne' : 'stroke-filet-fort'}`}
        />
      </svg>
      <span className={`text-xs whitespace-nowrap ${vivant ? 'text-antenne' : 'text-encre-3'}`}>{libelle}</span>
    </>
  );

  if (appelTelephone && !navigateur) {
    return (
      <Link
        href={`/appels/${appelTelephone}`}
        className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-survol"
        title="Rejoindre l’appel en cours : suivi, écoute, prise de main"
        role="status"
      >
        {contenu}
      </Link>
    );
  }
  if (telephone && (!telephone.pont || !telephone.connecte) && !navigateur) {
    return (
      <Link href="/telephone" className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-survol" role="status">
        {contenu}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2.5" role="status">
      {contenu}
    </div>
  );
}
