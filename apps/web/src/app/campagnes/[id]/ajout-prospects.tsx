'use client';

import type { IssueSysteme } from '@autocalled/domain';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { BarreActions } from '@/components/barre-actions';
import { useRaccourci } from '@/components/clavier';
import { Action, EtatVide, Filtre, Filtres, Message, Recherche, TitreSection } from '@/components/ui';
import { ajouterDansLaFile } from '../actions';

/**
 * Titre de la file et volet « Ajouter des prospects » (A). L'ajout n'appelle personne : les prospects choisis
 * passent en fin de file et une campagne en cours les appellera à leur tour. Aucune case n'est cochée d'office :
 * l'opérateur choisit. Seuls sont proposés les prospects de l'entreprise au numéro autorisé et absents de la
 * file ; le serveur refait ces contrôles au moment d'ajouter.
 *
 * Sous 640 px, la liste ne défile plus dans un cadre : la page défile, et « Ajouter » vit dans une barre
 * d'actions collée en bas (BarreActions).
 */

export interface ProspectAjoutable {
  id: string;
  nom: string;
  societe: string | null;
  /** Issue système du dernier appel et son libellé, null si jamais appelé. */
  derniere: { cle: IssueSysteme | null; libelle: string } | null;
}

type CleFiltre = 'jamais' | 'rappel';

const FILTRES: { cle: CleFiltre; libelle: string }[] = [
  { cle: 'jamais', libelle: 'Jamais appelés' },
  { cle: 'rappel', libelle: 'Rappel convenu' },
];

function dansFiltre(p: ProspectAjoutable, cle: CleFiltre): boolean {
  return cle === 'jamais' ? p.derniere === null : p.derniere?.cle === 'rappel-convenu';
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function SectionFile({
  campagneId,
  compte,
  ajoutables,
  blocage,
  children,
}: {
  campagneId: string;
  compte: number;
  /** null : campagne terminée, pas d'ajout possible. */
  ajoutables: ProspectAjoutable[] | null;
  /** Pourquoi l'ajout est fermé pour l'instant (fin demandée, script archivé), ou null. */
  blocage: string | null;
  children: React.ReactNode;
}) {
  const [volet, setVolet] = useState(false);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const proposer = ajoutables !== null;

  const fermer = () => {
    setVolet(false);
    requestAnimationFrame(() => bouton.current?.focus());
  };

  return (
    <section aria-labelledby="titre-file" className="grid grid-cols-1">
      <TitreSection
        id="titre-file"
        compte={compte}
        action={
          proposer ? (
            <Action
              ref={bouton}
              touche="A"
              raccourci="a"
              libelleRaccourci="Ajouter des prospects à la file"
              aria-expanded={volet}
              aria-controls="volet-ajout"
              className="-mr-1.5"
              onClick={() => {
                setAnnonce(null);
                setVolet((v) => !v);
              }}
            >
              {volet ? 'Fermer l’ajout' : 'Ajouter des prospects'}
            </Action>
          ) : undefined
        }
      >
        File
      </TitreSection>

      {annonce ? (
        <p role="status" className="pt-3 text-sm text-encre-2">
          {annonce}
        </p>
      ) : null}

      {volet && proposer ? (
        <section id="volet-ajout" aria-label="Ajouter des prospects à la file" className="border-b border-filet py-6">
          {blocage ? (
            <Message ton="neutre">{blocage}</Message>
          ) : (
            <FormulaireAjout
              campagneId={campagneId}
              ajoutables={ajoutables}
              onAnnuler={fermer}
              onAjoute={(n) => {
                setAnnonce(`${n} prospect${n > 1 ? 's ajoutés' : ' ajouté'} en fin de file.`);
                fermer();
              }}
            />
          )}
        </section>
      ) : null}

      {children}
    </section>
  );
}

function FormulaireAjout({
  campagneId,
  ajoutables,
  onAnnuler,
  onAjoute,
}: {
  campagneId: string;
  ajoutables: ProspectAjoutable[];
  onAnnuler: () => void;
  onAjoute: (n: number) => void;
}) {
  const [coches, setCoches] = useState<Set<string>>(() => new Set());
  const [filtre, setFiltre] = useState<CleFiltre | null>(null);
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const liste = useRef<HTMLUListElement>(null);

  useEffect(() => {
    liste.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  }, []);
  useRaccourci({ touche: 'Escape', libelle: 'Fermer l’ajout', actif: !enCours, action: onAnnuler });

  const comptes = useMemo(() => new Map(FILTRES.map((f) => [f.cle, ajoutables.filter((p) => dansFiltre(p, f.cle)).length])), [ajoutables]);
  const recherche = sansAccents(texte.trim());
  const visible = (p: ProspectAjoutable) =>
    (filtre === null || dansFiltre(p, filtre)) && (recherche === '' || sansAccents(`${p.nom} ${p.societe ?? ''}`).includes(recherche));
  const visibles = ajoutables.filter(visible);
  const cochesMasques = ajoutables.filter((p) => coches.has(p.id) && !visible(p)).length;

  const basculer = (id: string) =>
    setCoches((c) => {
      const suivant = new Set(c);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  const toutCocher = (oui: boolean) =>
    setCoches((c) => {
      const suivant = new Set(c);
      for (const p of visibles) {
        if (oui) suivant.add(p.id);
        else suivant.delete(p.id);
      }
      return suivant;
    });

  const ajouter = () =>
    demarrer(async () => {
      setErreur(null);
      // Dans l'ordre de la liste (alphabétique), comme à la création d'une campagne.
      const choisis = ajoutables.filter((p) => coches.has(p.id)).map((p) => p.id);
      try {
        const r = await ajouterDansLaFile(campagneId, choisis);
        if (!r.ok) return setErreur(r.raison);
        onAjoute(r.ajoutes);
      } catch {
        setErreur('L’ajout n’a pas abouti : rien n’a été ajouté. Réessaie.');
      }
    });

  if (ajoutables.length === 0) {
    return (
      <EtatVide
        forme="filtre"
        titre="Aucun prospect à ajouter."
        action={
          <Action ton="discret" touche="Échap" onClick={onAnnuler}>
            Fermer
          </Action>
        }
      >
        Tous les prospects au numéro autorisé sont déjà dans la file. Importe des fiches dans Prospects pour en ajouter d’autres.
      </EtatVide>
    );
  }

  return (
    // Un formulaire, pour que le champ au focus remonte au-dessus de la barre d'actions (globals.css).
    <form
      aria-label="Ajouter des prospects à la file"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (coches.size > 0 && !enCours) ajouter();
      }}
    >
      <p className="text-sm text-encre-3">
        Prospects de l’entreprise au numéro autorisé, absents de la file. Ils passent en fin de file, dans l’ordre alphabétique ; personne n’est appelé
        maintenant.
      </p>
      {/* Sous 640 px, la recherche en tête, pleine largeur, puis la rangée de filtres qui défile. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 max-sm:grid max-sm:grid-cols-1">
        <Filtres libelle="Filtrer les prospects à ajouter">
          <Filtre actif={filtre === null} compte={ajoutables.length} onClick={() => setFiltre(null)}>
            Tous
          </Filtre>
          {FILTRES.map((f) => (
            <Filtre key={f.cle} actif={filtre === f.cle} compte={comptes.get(f.cle) ?? 0} onClick={() => setFiltre(f.cle)}>
              {f.libelle}
            </Filtre>
          ))}
        </Filtres>
        <Recherche
          sansFormulaire
          instantane={setTexte}
          placeholder="Chercher un prospect"
          libelle="Chercher un prospect à ajouter"
          className="w-full max-sm:order-first sm:w-[300px]"
        />
      </div>
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4">
        <Action ton="discret" disabled={visibles.length === 0} onClick={() => toutCocher(true)}>
          Tout cocher
        </Action>
        <Action ton="discret" disabled={visibles.length === 0} onClick={() => toutCocher(false)}>
          Rien
        </Action>
        {filtre !== null || recherche ? <span className="px-1.5 text-sm text-encre-3">Sur les lignes affichées.</span> : null}
      </div>

      {visibles.length === 0 ? <EtatVide forme="filtre" titre="Aucun prospect ne correspond." /> : null}
      {/* Un cadre qui défile au bureau seulement : au doigt, jamais de défilement dans le défilement. */}
      <ul ref={liste} className="border-t border-filet sm:max-h-[50vh] sm:overflow-y-auto">
        {ajoutables.map((p) => (
          <li key={p.id} hidden={!visible(p)}>
            <label className="flex min-h-[38px] cursor-pointer items-center gap-3 border-b border-filet px-1 py-1.5 text-md transition-colors duration-100 hover:bg-survol pointer-coarse:min-h-11">
              <input type="checkbox" checked={coches.has(p.id)} onChange={() => basculer(p.id)} className="size-4 shrink-0 accent-[var(--encre)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <span className="font-medium">{p.nom}</span>
                  {p.societe ? <span className="text-encre-3"> · {p.societe}</span> : null}
                </span>
                {/* Sous 640 px, la dernière issue passe sous le nom. */}
                <span className="block truncate text-sm text-encre-3 sm:hidden">{p.derniere ? p.derniere.libelle : 'Jamais appelé'}</span>
              </span>
              <span className="shrink-0 text-sm text-encre-3 max-sm:hidden">{p.derniere ? p.derniere.libelle : 'Jamais appelé'}</span>
            </label>
          </li>
        ))}
      </ul>

      {/* Dans un volet que la file suit : pas de marge négative de fin de page ;
          une colonne bornée, sinon le statut non coupé élargit la barre au-delà de l'écran. */}
      <BarreActions
        className="mb-0! grid-cols-1"
        messages={erreur ? <Message ton="alerte">{erreur}</Message> : null}
        statut={
          cochesMasques > 0 ? (
            <span className="text-encre-2">
              dont <span className="font-mono">{cochesMasques}</span> hors du filtre
            </span>
          ) : null
        }
      >
        <Action
          ton="fort"
          type="submit"
          className="-ml-1.5"
          disabled={coches.size === 0 || enCours}
          enCours={enCours}
          libelleEnCours="Ajout…"
          aria-label={`Ajouter ${coches.size} prospect${coches.size > 1 ? 's' : ''} à la file`}
        >
          Ajouter {coches.size}
          <span className="max-sm:hidden"> prospect{coches.size > 1 ? 's' : ''} à la file</span>
        </Action>
        <Action ton="discret" touche="Échap" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Action>
      </BarreActions>
    </form>
  );
}
