'use client';

import type { IssueSysteme, RaisonRefus } from '@autocalled/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { nouvelleCampagne } from '@/app/campagnes/actions';
import { useNomAssistante } from '@/components/assistante';
import { REFUS_NUMERO } from '@/components/refus-numero';
import { useFormulaire } from '@/components/use-formulaire';
import { BarreActions } from '@/components/barre-actions';
import { Action, Champ, EtatVide, Filtre, Filtres, LienAction, Message, Recherche, Selection, TitreSection } from '@/components/ui';
import type { EtatFormulaire } from '@/lib/formulaire';

/**
 * Création d'une campagne, en volet au-dessus de la liste (N). Rien ne sonne à la création : la campagne est
 * « Prête » et se lance depuis sa page, après un récapitulatif.
 *
 * Sous 640 px, la liste des prospects ne défile plus dans un cadre : la page défile, et « Créer » vit dans une
 * barre d'actions collée en bas (BarreActions), avec le compte des cochés masqués par le filtre.
 */

export interface ProspectCampagne {
  id: string;
  nom: string;
  societe: string | null;
  /** Pourquoi son numéro ne serait pas composé (invalide, personne effacée) ; null s'il le serait. */
  refus: RaisonRefus | null;
  /** Issue système du dernier appel, et son libellé affiché. */
  derniere: { cle: IssueSysteme | null; libelle: string } | null;
  /** Un rendez-vous a déjà été pris avec ce prospect. */
  rendezVous: boolean;
}

type CleFiltre = 'jamais' | 'rappel' | 'rendez-vous' | 'refus' | 'non-appelables';

const FILTRES: { cle: CleFiltre; libelle: string }[] = [
  { cle: 'jamais', libelle: 'Jamais appelés' },
  { cle: 'rappel', libelle: 'Rappel convenu' },
  { cle: 'rendez-vous', libelle: 'Déjà un rendez-vous' },
  { cle: 'refus', libelle: 'Refus' },
  { cle: 'non-appelables', libelle: 'Non appelables' },
];

function dansFiltre(p: ProspectCampagne, cle: CleFiltre): boolean {
  switch (cle) {
    case 'jamais':
      return p.derniere === null;
    case 'rappel':
      return p.derniere?.cle === 'rappel-convenu';
    case 'rendez-vous':
      return p.rendezVous;
    case 'refus':
      return p.derniere?.cle === 'refus';
    case 'non-appelables':
      return p.refus !== null;
  }
}

/** Cochés d'office : les prospects appelables dont le dernier appel n'a fini ni en rendez-vous pris ni en refus (pas de rappel par mégarde). */
function cocheParDefaut(p: ProspectCampagne): boolean {
  return p.refus === null && p.derniere?.cle !== 'rendez-vous-pris' && p.derniere?.cle !== 'refus';
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const LIGNES = [
  { valeur: 'bluetooth', libelle: 'Téléphone passerelle', aide: (assistante: string) => `${assistante} appelle les vrais numéros` },
  { valeur: 'navigateur', libelle: 'Ligne navigateur', aide: () => 'tu joues chaque prospect' },
  { valeur: 'simulation', libelle: 'Simulation', aide: () => 'un modèle joue les prospects' },
] as const;

export function FormulaireCampagne({
  entrepriseId,
  versions,
  prospects,
  focusAuMontage = false,
}: {
  entrepriseId: string;
  versions: { id: string; libelle: string }[];
  prospects: ProspectCampagne[];
  focusAuMontage?: boolean;
}) {
  const nomAssistante = useNomAssistante();
  const { etat, enCours, proprietes } = useFormulaire<EtatFormulaire>(nouvelleCampagne.bind(null, entrepriseId), null);
  const [coches, setCoches] = useState<Set<string>>(() => new Set(prospects.filter(cocheParDefaut).map((p) => p.id)));
  const [filtre, setFiltre] = useState<CleFiltre | null>(null);
  const [texte, setTexte] = useState('');
  const version = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (focusAuMontage) version.current?.focus();
  }, [focusAuMontage]);

  const comptes = useMemo(() => new Map(FILTRES.map((f) => [f.cle, prospects.filter((p) => dansFiltre(p, f.cle)).length])), [prospects]);
  const recherche = sansAccents(texte.trim());
  const visible = (p: ProspectCampagne) =>
    (filtre === null || dansFiltre(p, filtre)) && (recherche === '' || sansAccents(`${p.nom} ${p.societe ?? ''}`).includes(recherche));
  const visibles = prospects.filter(visible);
  // Cochés mais masqués par un filtre ou la recherche : ils partent quand même, le bouton le dit.
  const cochesMasques = prospects.filter((p) => coches.has(p.id) && !visible(p)).length;
  const cochables = visibles.filter((p) => p.refus === null);
  const appelables = prospects.filter((p) => p.refus === null).length;

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
      for (const p of cochables) {
        if (oui) suivant.add(p.id);
        else suivant.delete(p.id);
      }
      return suivant;
    });

  return (
    <form {...proprietes} aria-label="Nouvelle campagne" className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-10">
        <Champ libelle="Version de script" htmlFor="versionScriptId">
          <Selection ref={version} id="versionScriptId" name="versionScriptId" className="font-mono">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.libelle}
              </option>
            ))}
          </Selection>
        </Champ>
        <fieldset className="grid min-w-0 gap-1">
          <legend className="mb-1.5 text-sm font-medium">Ligne</legend>
          {/* Bouton calé sur la première ligne : le libellé passe sur deux lignes en fenêtre étroite. */}
          {LIGNES.map((l, i) => (
            <label key={l.valeur} className="flex min-h-7 cursor-pointer items-start gap-2.5 py-1 text-md pointer-coarse:min-h-11 pointer-coarse:py-3">
              <input type="radio" name="ligne" value={l.valeur} defaultChecked={i === 0} className="mt-0.5 size-4 shrink-0 accent-[var(--encre)]" />
              <span>
                <span className="font-medium">{l.libelle}</span>
                <span className="text-encre-3"> : {l.aide(nomAssistante)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      {/* min-w-0 : un fieldset prend la largeur de son contenu le plus large, la rangée de filtres qui défile. */}
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-1 text-sm font-medium">Prospects, appelés dans l’ordre alphabétique</legend>
        {/* Sous 640 px, la recherche en tête, pleine largeur, puis la rangée de filtres qui défile. */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 max-sm:grid max-sm:grid-cols-1">
          <Filtres libelle="Filtrer les prospects de la campagne">
            <Filtre actif={filtre === null} compte={prospects.length} onClick={() => setFiltre(null)}>
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
          <Action ton="discret" disabled={cochables.length === 0} onClick={() => toutCocher(true)}>
            Tout cocher
          </Action>
          <Action ton="discret" disabled={cochables.length === 0} onClick={() => toutCocher(false)}>
            Rien
          </Action>
          <span className="px-1.5 text-sm text-encre-3">
            {filtre !== null || recherche ? 'Sur les lignes affichées. ' : ''}
            <span className="font-mono">{appelables}</span> appelable{appelables > 1 ? 's' : ''} sur{' '}
            <span className="font-mono">{prospects.length}</span>.
          </span>
        </div>

        {visibles.length === 0 ? <EtatVide forme="filtre" titre="Aucun prospect ne correspond." /> : null}
        {/* Les lignes filtrées restent dans le formulaire (hidden) : un prospect coché puis masqué part quand même. */}
        {/* Un cadre qui défile au bureau seulement : au doigt, jamais de défilement dans le défilement. */}
        <ul className="border-t border-filet sm:max-h-[60vh] sm:overflow-y-auto">
          {prospects.map((p) => {
            const appelable = p.refus === null;
            return (
              <li key={p.id} hidden={!visible(p)}>
                <label
                  className={`flex min-h-[38px] items-center gap-3 border-b border-filet px-1 py-1.5 text-md transition-colors duration-100 hover:bg-survol pointer-coarse:min-h-11 ${
                    appelable ? 'cursor-pointer' : 'cursor-not-allowed text-encre-3'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="prospects"
                    value={p.id}
                    checked={appelable && coches.has(p.id)}
                    disabled={!appelable}
                    onChange={() => basculer(p.id)}
                    className="size-4 shrink-0 accent-[var(--encre)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className={appelable ? 'font-medium' : ''}>{p.nom}</span>
                      {p.societe ? <span className="text-encre-3"> · {p.societe}</span> : null}
                    </span>
                    {/* Sous 640 px, la dernière issue passe sous le nom. */}
                    {appelable ? (
                      <span className="block truncate text-sm text-encre-3 sm:hidden">{p.derniere ? p.derniere.libelle : 'Jamais appelé'}</span>
                    ) : null}
                  </span>
                  {appelable ? (
                    <span className="shrink-0 text-sm text-encre-3 max-sm:hidden">{p.derniere ? p.derniere.libelle : 'Jamais appelé'}</span>
                  ) : (
                    <span className="shrink-0 text-sm text-alerte">Numéro {p.refus ? REFUS_NUMERO[p.refus] : ''}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {/* Dans un volet que la liste des campagnes suit : pas de marge négative de fin de page. */}
      <BarreActions
        className="mb-0!"
        messages={etat?.message ? <Message ton="alerte">{etat.message}</Message> : null}
        statut={
          cochesMasques > 0 ? (
            <span className="text-encre-2">
              dont <span className="font-mono">{cochesMasques}</span> hors du filtre
            </span>
          ) : (
            <span className="text-encre-3">
              <span className="max-sm:hidden">Rien ne sonne avant que tu la lances.</span>
              <span className="sm:hidden">Rien ne sonne ici.</span>
            </span>
          )
        }
      >
        <Action
          ton="fort"
          type="submit"
          className="-ml-1.5"
          disabled={coches.size === 0 || enCours}
          enCours={enCours}
          libelleEnCours="Création…"
          aria-label={`Créer la campagne : ${coches.size} prospect${coches.size > 1 ? 's' : ''}`}
        >
          <span className="max-sm:hidden">Créer la campagne · </span>
          <span className="sm:hidden">Créer · </span>
          {coches.size} prospect{coches.size > 1 ? 's' : ''}
        </Action>
      </BarreActions>
    </form>
  );
}

/**
 * Titre, volet de création et liste des campagnes. La liste est rendue par le serveur (children) ; le volet
 * s'ouvre par N ou le bouton, et remplace l'ancienne colonne de droite.
 */
export function SectionCampagnes({
  compte,
  prerequis,
  entrepriseId,
  versions,
  prospects,
  vide,
  children,
}: {
  compte: number;
  prerequis: { texte: string; lien: { href: string; libelle: string } } | null;
  entrepriseId: string;
  versions: { id: string; libelle: string }[];
  prospects: ProspectCampagne[];
  vide: boolean;
  children: React.ReactNode;
}) {
  const [volet, setVolet] = useState(false);
  const [parGeste, setParGeste] = useState(false);
  const ouvrir = () => {
    setParGeste(true);
    setVolet(true);
  };

  return (
    <div className="grid grid-cols-1">
      <TitreSection
        compte={compte}
        action={
          prerequis ? undefined : (
            <Action
              touche="N"
              raccourci="n"
              libelleRaccourci="Nouvelle campagne"
              aria-expanded={volet}
              aria-controls="volet-campagne"
              onClick={() => (volet ? setVolet(false) : ouvrir())}
            >
              {volet ? 'Fermer la création' : 'Nouvelle campagne'}
            </Action>
          )
        }
      >
        Campagnes
      </TitreSection>

      {prerequis ? (
        <Message ton="neutre" className="mt-4" action={<LienAction href={prerequis.lien.href}>{prerequis.lien.libelle}</LienAction>}>
          {prerequis.texte}
        </Message>
      ) : null}

      {volet && !prerequis ? (
        <section id="volet-campagne" aria-label="Nouvelle campagne" className="border-b border-filet py-6">
          <FormulaireCampagne entrepriseId={entrepriseId} versions={versions} prospects={prospects} focusAuMontage={parGeste} />
        </section>
      ) : null}

      {vide ? (
        <EtatVide
          titre="Aucune campagne."
          action={
            prerequis || volet ? undefined : (
              <Action ton="fort" touche="N" onClick={ouvrir}>
                Nouvelle campagne
              </Action>
            )
          }
        >
          Une campagne appelle une liste de prospects l’un après l’autre, avec une même version de script.
        </EtatVide>
      ) : (
        children
      )}
    </div>
  );
}
