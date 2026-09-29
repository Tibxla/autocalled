'use client';

import Form from 'next/form';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { focaliserPremiereLigne, inscrireRecherche, useRaccourci } from './clavier';
import { Touche } from './touche';
import { lienAvec } from './url';

/**
 * Recherche sur filet bas, « / » à droite. Formulaire GET (navigation client de next/form) : la page relit
 * la base avec `?q=`. `instantane` filtre en plus à chaque frappe une liste déjà chargée en entier.
 * « / » partout y met le focus (le dernier champ monté gagne) ; Échap vide le champ puis, si la recherche
 * était appliquée côté serveur, retire le paramètre de l'URL ; champ vide, Échap rend le focus à la page.
 * ↓ passe aux résultats : la première ligne de la liste de la page (NavigationListe) prend le focus.
 * `longueurMin` : Entrée ne part vers le serveur qu'à partir de ce nombre de caractères. `scroll={false}` :
 * la page ne remonte pas après la recherche. `sansFormulaire` : champ seul, sans <form> ni nom, pour vivre
 * dans un autre formulaire (Entrée n'y soumet rien) ; il suppose `instantane`.
 */
export function Recherche({
  nom = 'q',
  valeur = '',
  placeholder,
  action,
  conserver,
  instantane,
  libelle = 'Rechercher',
  className = 'w-full sm:w-[300px]',
  longueurMin = 0,
  scroll,
  sansFormulaire = false,
}: {
  nom?: string;
  valeur?: string;
  placeholder: string;
  action?: string;
  conserver?: Record<string, string | undefined>;
  instantane?: (texte: string) => void;
  libelle?: string;
  className?: string;
  longueurMin?: number;
  scroll?: boolean;
  sansFormulaire?: boolean;
}) {
  const router = useRouter();
  const champ = useRef<HTMLInputElement>(null);
  const id = useId();
  const [texte, setTexte] = useState(valeur);
  // Navigation (retour, filtre) : la valeur appliquée change, le champ la suit.
  const [valeurVue, setValeurVue] = useState(valeur);
  if (valeur !== valeurVue) {
    setValeurVue(valeur);
    setTexte(valeur);
  }

  useEffect(() => {
    if (!champ.current) return;
    return inscrireRecherche(champ.current);
  }, []);

  // Depuis le champ, ↓ mène aux résultats (sans passer par tous les filtres au Tab).
  useRaccourci({
    touche: 'ArrowDown',
    libelle: 'Aller aux résultats de la recherche',
    groupe: 'Liste',
    dansChamp: true,
    action: (e) => e.target === champ.current && focaliserPremiereLigne(),
  });

  const seulementLocal = Boolean(instantane) && action === undefined;
  // next/form ne respecte preventDefault que si onSubmit est fourni.
  const onSubmit =
    seulementLocal || longueurMin > 0
      ? (e: React.FormEvent<HTMLFormElement>) => {
          if (seulementLocal || texte.trim().length < longueurMin) e.preventDefault();
        }
      : undefined;

  const champSaisie = (
    <label
      htmlFor={id}
      className="flex h-[30px] items-center gap-2.5 border-b border-filet-fort transition-[border-color] duration-150 focus-within:border-encre hover:border-souligne focus-within:hover:border-encre pointer-coarse:h-11"
    >
      <span className="sr-only">{libelle}</span>
      <input
        ref={champ}
        id={id}
        type="search"
        name={sansFormulaire ? undefined : nom}
        value={texte}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        aria-keyshortcuts="/"
        onChange={(e) => {
          setTexte(e.target.value);
          instantane?.(e.target.value);
        }}
        onKeyDown={(e) => {
          // Dans un autre formulaire, Entrée ne le soumet pas.
          if (sansFormulaire && e.key === 'Enter') e.preventDefault();
          if (e.key !== 'Escape') return;
          e.preventDefault();
          if (texte) {
            setTexte('');
            instantane?.('');
            if (valeur && !sansFormulaire) {
              const parametres = Object.fromEntries(new URLSearchParams(location.search));
              router.replace(lienAvec(location.pathname, parametres, { [nom]: null }), { scroll: false });
            }
          } else e.currentTarget.blur();
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-md text-encre placeholder:text-encre-3 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
      {texte ? null : <Touche decorative>/</Touche>}
    </label>
  );

  if (sansFormulaire)
    return (
      <div role="search" className={className}>
        {champSaisie}
      </div>
    );

  return (
    <Form action={action ?? ''} role="search" onSubmit={onSubmit} {...(scroll === undefined ? {} : { scroll })} className={className}>
      {Object.entries(conserver ?? {}).map(([cle, v]) =>
        v === undefined || v === '' || cle === nom ? null : <input key={cle} type="hidden" name={cle} value={v} />,
      )}
      {champSaisie}
    </Form>
  );
}
