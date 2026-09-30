'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { ChampConnu, MessageConflit } from '@/components/conflit';
import { BarreActions } from '@/components/barre-actions';
import { Action, Champ, Message, ZoneTexte } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import type { Etape } from '@/db/schema';
import type { EtatFormulaire } from '@/lib/formulaire';
import { creerVersion } from '../../actions';

/** Limites d'etapesSchema (lib/schemas.ts), vérifiées ici avant l'envoi pour répondre en français sur l'étape fautive. */
const MAX_ETAPES = 10;
const MAX_FORMULATIONS = 4;
const MAX_CARACTERES = 300;
const MIN_INTENTION = 3;

interface Ligne {
  cle: string;
  intention: string;
  exemples: string;
  /** Rang de l'étape au moment du retrait, pour « Étape 3 retirée · Annuler ». */
  retireeA: number | null;
}

type Erreurs = Record<string, string>;

const formulations = (texte: string) =>
  texte
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Éditeur d'une nouvelle version : la version affichée reste figée, l'enregistrement crée la suivante.
 * Champs contrôlés (déplacer, retirer et annuler un retrait gardent la saisie) ; seules les étapes non
 * retirées sont envoyées, dans l'ordre affiché. useFormulaire garde la saisie après un refus du serveur
 * (version identique à la précédente) et avertit avant de fermer l'onglet.
 *
 * L'intention est une zone de texte d'une ligne qui grandit avec son contenu (une intention longue se lit en entier
 * au téléphone) ; Entrée n'y saute pas de ligne, Ctrl+Entrée enregistre. L'enregistrement vit dans une BarreActions
 * collée en bas, avec le statut, les refus et la confirmation d'« Abandonner », qui y remplace les actions.
 */
export function EditeurVersion({
  entrepriseId,
  scriptId,
  etapes,
  origine,
  prochainNumero,
  onFermer,
  onEnregistree,
  onRecharger,
}: {
  entrepriseId: string;
  scriptId: string;
  etapes: Etape[];
  origine: number;
  /** Le numéro suivant la dernière version connue : la garde de concurrence renvoie `prochainNumero - 1`. */
  prochainNumero: number;
  onFermer: () => void;
  onEnregistree: () => void;
  /** Après un refus pour une version créée ailleurs : ferme l'éditeur et relit la page. */
  onRecharger: () => void;
}) {
  const { etat, enCours, modifie, proprietes } = useFormulaire<EtatFormulaire>(creerVersion.bind(null, entrepriseId, scriptId), null, {
    avertirSiQuitte: true,
  });
  const idBase = useId();
  const suivante = useRef(0);
  const [lignes, setLignes] = useState<Ligne[]>(() =>
    etapes.map((e, i) => ({ cle: `e${i}`, intention: e.intention, exemples: e.exemples.join('\n'), retireeA: null })),
  );
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const confirmation = useConfirmation();

  const actives = lignes.filter((l) => l.retireeA === null);
  const rang = (cle: string) => actives.findIndex((l) => l.cle === cle) + 1;
  const idChamp = (cle: string, champ: 'intention' | 'exemples') => `${idBase}-${champ}-${cle}`;

  // Succès : l'éditeur se ferme, la page relue affiche la nouvelle version.
  const vu = useRef(etat);
  useEffect(() => {
    if (vu.current === etat) return;
    vu.current = etat;
    if (etat?.ok) onEnregistree();
  }, [etat, onEnregistree]);

  // Refus : chaque erreur du serveur (clé « rang:champ », rang dans l'ordre envoyé) revient sous le champ de
  // son étape, une fois par réponse (ajustement pendant le rendu, sans effet).
  const [reponseLue, setReponseLue] = useState(etat);
  if (reponseLue !== etat) {
    setReponseLue(etat);
    const parEtape: Erreurs = {};
    for (const [cle, message] of Object.entries(etat?.erreurs ?? {})) {
      const [rangEnvoye, champ] = cle.split(':');
      const ligne = actives[Number(rangEnvoye)];
      if (ligne && (champ === 'intention' || champ === 'exemples')) parEtape[`${ligne.cle}:${champ}`] = message;
    }
    if (Object.keys(parEtape).length > 0) setErreurs(parEtape);
  }

  const toucher = () => proprietes.onInput();
  const changer = (cle: string, changement: Partial<Ligne>) => {
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, ...changement } : x)));
    if (erreurs[`${cle}:intention`] || erreurs[`${cle}:exemples`]) {
      setErreurs((e) => {
        const suite = { ...e };
        if ('intention' in changement) delete suite[`${cle}:intention`];
        if ('exemples' in changement) delete suite[`${cle}:exemples`];
        return suite;
      });
    }
  };
  const deplacer = (cle: string, pas: -1 | 1) => {
    setLignes((l) => {
      const visibles = l.flatMap((x, i) => (x.retireeA === null ? [i] : []));
      const ici = visibles.findIndex((i) => l[i]!.cle === cle);
      const la = visibles[ici + pas];
      if (ici < 0 || la === undefined) return l;
      const copie = [...l];
      const i = visibles[ici]!;
      [copie[i], copie[la]] = [copie[la]!, copie[i]!];
      return copie;
    });
    toucher();
    // Le focus suit l'étape déplacée.
    requestAnimationFrame(() => document.getElementById(`${idBase}-${pas < 0 ? 'monter' : 'descendre'}-${cle}`)?.focus());
  };
  const retirer = (cle: string) => {
    changer(cle, { retireeA: rang(cle) });
    toucher();
    requestAnimationFrame(() => document.getElementById(`${idBase}-annuler-${cle}`)?.focus());
  };
  const restaurer = (cle: string) => {
    changer(cle, { retireeA: null });
    toucher();
  };
  const ajouter = () => {
    const cle = `n${suivante.current++}`;
    setLignes((l) => [...l, { cle, intention: '', exemples: '', retireeA: null }]);
    toucher();
    requestAnimationFrame(() => document.getElementById(idChamp(cle, 'intention'))?.focus());
  };

  const valider = (): Erreurs => {
    const e: Erreurs = {};
    const remplies = actives.filter((l) => l.intention.trim() || formulations(l.exemples).length);
    if (remplies.length === 0) {
      const premiere = actives[0];
      if (premiere) e[`${premiere.cle}:intention`] = 'Un script a au moins une étape : écris son intention.';
      return e;
    }
    for (const l of remplies) {
      const n = rang(l.cle);
      const intention = l.intention.trim();
      if (intention.length < MIN_INTENTION) e[`${l.cle}:intention`] = `L’intention de l’étape ${n} fait moins de trois caractères.`;
      else if (intention.length > MAX_CARACTERES) e[`${l.cle}:intention`] = `L’intention de l’étape ${n} dépasse ${MAX_CARACTERES} caractères.`;
      const f = formulations(l.exemples);
      if (f.length > MAX_FORMULATIONS) e[`${l.cle}:exemples`] = `Quatre formulations au plus pour l’étape ${n} (il y en a ${f.length}).`;
      else if (f.some((x) => x.length > MAX_CARACTERES)) e[`${l.cle}:exemples`] = `Une formulation de l’étape ${n} dépasse ${MAX_CARACTERES} caractères.`;
    }
    return e;
  };

  const envoyer = (ev: React.FormEvent<HTMLFormElement>) => {
    const e = valider();
    setErreurs(e);
    const premiere = Object.keys(e)[0];
    if (premiere) {
      ev.preventDefault();
      setErreurGenerale(`${Object.keys(e).length > 1 ? `${Object.keys(e).length} étapes à corriger` : 'Une étape à corriger'} avant d’enregistrer : rien n’a été envoyé.`);
      const [cle, champ] = premiere.split(':') as [string, 'intention' | 'exemples'];
      requestAnimationFrame(() => document.getElementById(idChamp(cle, champ))?.focus());
      return;
    }
    setErreurGenerale(null);
    proprietes.onSubmit(ev);
  };

  useRaccourci({
    touche: 'Enter',
    ctrl: true,
    dansChamp: true,
    libelle: `Enregistrer comme v${prochainNumero}`,
    actif: !enCours && !confirmation.ouverte,
    action: () => {
      // Comme la soumission native : seulement depuis le formulaire lui-même.
      const f = proprietes.ref.current;
      if (!f?.contains(document.activeElement)) return false;
      f.requestSubmit();
    },
  });

  const abandonner = () => (modifie ? confirmation.ouvrir() : onFermer());
  const erreursEtapes = Object.keys(etat?.erreurs ?? {}).filter((cle) => cle.includes(':')).length;
  const refusServeur =
    etat && !etat.ok
      ? (etat.erreurs?.etapes ??
        etat.message ??
        (erreursEtapes > 0 ? `${erreursEtapes > 1 ? `${erreursEtapes} erreurs` : 'Une erreur'} à corriger dans les étapes : rien n’a été enregistré.` : null))
      : null;

  return (
    <form {...proprietes} onSubmit={envoyer} aria-label={`Nouvelle version v${prochainNumero}`} className="grid gap-4">
      <ChampConnu valeur={String(prochainNumero - 1)} />
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-sm text-encre-3">
            À partir de la <span className="font-mono">v{origine}</span> : l’enregistrement crée la{' '}
            <span className="font-mono">v{prochainNumero}</span>, la <span className="font-mono">v{origine}</span> ne change pas.
          </p>
          <span className={`font-mono text-sm ${actives.length > MAX_ETAPES ? 'text-alerte' : 'text-encre-3'}`}>
            {actives.length}/{MAX_ETAPES} étapes
          </span>
        </div>
        {/* Dite une fois pour toutes les étapes. */}
        <p className="max-w-[68ch] text-sm text-encre-3">
          Formulations d’exemple : une par ligne, entre une et quatre par étape. Tu peux écrire{' '}
          <span className="font-mono">{'{{assistante_nom}}'}</span>, <span className="font-mono">{'{{prospect_nom}}'}</span>,{' '}
          <span className="font-mono">{'{{prospect_societe}}'}</span> : remplacés au début de l’appel.
        </p>
      </div>

      <ol className="border-t border-filet">
        {lignes.map((l) => {
          if (l.retireeA !== null) {
            return (
              <li key={l.cle} className="flex min-h-[38px] flex-wrap items-center gap-x-2 border-b border-filet text-sm text-encre-3">
                <span>
                  Étape <span className="font-mono">{l.retireeA}</span> retirée
                  {l.intention.trim() ? ` (${l.intention.trim().slice(0, 60)})` : ''}
                </span>
                <span aria-hidden="true">·</span>
                <Action id={`${idBase}-annuler-${l.cle}`} ton="discret" onClick={() => restaurer(l.cle)} disabled={actives.length >= MAX_ETAPES}>
                  Annuler le retrait
                </Action>
              </li>
            );
          }
          const n = rang(l.cle);
          const nombre = formulations(l.exemples).length;
          return (
            <li key={l.cle} className="grid gap-3 border-b border-filet py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
              <span className="font-mono text-sm text-encre-3 sm:pt-7">{n}</span>
              <div className="grid gap-4">
                <Champ libelle={`Étape ${n}, intention`} htmlFor={idChamp(l.cle, 'intention')} erreur={erreurs[`${l.cle}:intention`]}>
                  <ZoneTexte
                    id={idChamp(l.cle, 'intention')}
                    name="intention"
                    rows={1}
                    value={l.intention}
                    // Une intention tient sur une ligne : ni Entrée ni un collage n'y mettent de saut de ligne.
                    onChange={(ev) => changer(l.cle, { intention: ev.target.value.replace(/\s*\n\s*/g, ' ') })}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey) ev.preventDefault();
                    }}
                    enterKeyHint="next"
                    placeholder="Ce que l’étape doit obtenir"
                    autoComplete="off"
                    className="min-h-0! resize-none! text-md"
                  />
                </Champ>
                <Champ
                  libelle="Formulations d’exemple"
                  htmlFor={idChamp(l.cle, 'exemples')}
                  erreur={erreurs[`${l.cle}:exemples`]}
                  complement={
                    <span className={`font-mono text-sm ${nombre > MAX_FORMULATIONS ? 'text-alerte' : 'text-encre-3'}`}>
                      {nombre}/{MAX_FORMULATIONS} formulations
                    </span>
                  }
                >
                  <ZoneTexte
                    id={idChamp(l.cle, 'exemples')}
                    name="exemples"
                    value={l.exemples}
                    onChange={(ev) => changer(l.cle, { exemples: ev.target.value })}
                    placeholder="Une formulation par ligne"
                    className="min-h-16 text-md"
                  />
                </Champ>
              </div>
              {/* Sous 640 px, « Monter » et « Descendre » en toutes lettres, Retirer à l'autre bout. */}
              <div className="-mx-1.5 flex items-start gap-2 sm:flex-col sm:items-end sm:gap-1 sm:pt-6">
                <Action id={`${idBase}-monter-${l.cle}`} ton="discret" className="sm:text-base" aria-label={`Monter l’étape ${n}`} disabled={n === 1} onClick={() => deplacer(l.cle, -1)}>
                  <span className="sm:hidden">Monter</span>
                  <span className="max-sm:hidden">↑</span>
                </Action>
                <Action
                  id={`${idBase}-descendre-${l.cle}`}
                  ton="discret"
                  className="sm:text-base"
                  aria-label={`Descendre l’étape ${n}`}
                  disabled={n === actives.length}
                  onClick={() => deplacer(l.cle, 1)}
                >
                  <span className="sm:hidden">Descendre</span>
                  <span className="max-sm:hidden">↓</span>
                </Action>
                <Action ton="discret" className="max-sm:ml-auto" aria-label={`Retirer l’étape ${n}`} disabled={actives.length === 1} onClick={() => retirer(l.cle)}>
                  Retirer
                </Action>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="-mx-1.5 flex flex-wrap items-center gap-x-3">
        <Action onClick={ajouter} disabled={actives.length >= MAX_ETAPES}>
          Ajouter une étape
        </Action>
        {actives.length >= MAX_ETAPES ? <span className="text-sm text-encre-3">Dix étapes au plus</span> : null}
      </div>

      <BarreActions
        className="mb-0!"
        messages={
          confirmation.ouverte ? (
            <Confirmation
              ouverte
              question="Abandonner les modifications ?"
              libelleConfirmer="Abandonner"
              libelleAnnuler="Continuer l’édition"
              ton="alerte"
              onConfirmer={() => {
                confirmation.fermer();
                onFermer();
              }}
              onAnnuler={confirmation.fermer}
              className="max-w-[44rem]"
            >
              Rien n’est enregistré : la <span className="font-mono">v{origine}</span> reste telle quelle.
            </Confirmation>
          ) : erreurGenerale || (etat?.conflit && etat.message) || refusServeur ? (
            <>
              {erreurGenerale ? <Message ton="alerte">{erreurGenerale}</Message> : null}
              {etat?.conflit && etat.message ? (
                <MessageConflit
                  message={etat.message}
                  jeton={etat.conflit.jeton}
                  onRecharger={onRecharger}
                  libelleEcraser={`Enregistrer quand même comme v${Number(etat.conflit.jeton) + 1}`}
                  explication={`Recharger ferme l’éditeur et montre la v${etat.conflit.jeton} ; enregistrer quand même crée la v${Number(etat.conflit.jeton) + 1} avec ta saisie.`}
                  desactive={enCours}
                />
              ) : refusServeur ? (
                <Message ton="alerte">{refusServeur}</Message>
              ) : null}
            </>
          ) : null
        }
        statut={
          modifie && !confirmation.ouverte ? (
            <span className="text-encre-2">
              <span className="sm:hidden">Non enregistré</span>
              <span className="max-sm:hidden">Modifications non enregistrées</span>
            </span>
          ) : null
        }
      >
        {/* La confirmation d'« Abandonner » prend la place des actions tant qu'elle est ouverte ; masquées et non
            démontées, elles rendent le focus à « Abandonner » quand on la referme. */}
        <div className={`-mx-1.5 items-center gap-x-4 pointer-coarse:mx-0 ${confirmation.ouverte ? 'hidden' : 'flex'}`}>
          <Action type="submit" ton="fort" touche="Ctrl Entrée" enCours={enCours} libelleEnCours="Enregistrement…" disabled={enCours}>
            Enregistrer comme v{prochainNumero}
          </Action>
          <Action ton="discret" onClick={abandonner} disabled={enCours} aria-expanded={confirmation.ouverte}>
            Abandonner
          </Action>
        </div>
      </BarreActions>
    </form>
  );
}
