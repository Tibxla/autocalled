'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { BoutonArchive } from '@/components/bouton-archive';
import { useRaccourci, useRaccourcis } from '@/components/clavier';
import { Action, Chevron, EtatVide, TitreSection } from '@/components/ui';
import { basculerArchiveObjection, deplacerObjection } from '../actions';
import { FormulaireObjection, TEMPS, type Objection } from './formulaire-objection';

export interface ChiffresObjection {
  apparitions: number;
  levees: number;
  temps: string | null;
}

const VERBE_TEMPS: Record<string, string> = Object.fromEntries(TEMPS.map((t) => [t.nom, t.verbe]));

/**
 * C R A C : le temps rempli en encre, le temps vide en encre-3 ; la phrase complète pour les lecteurs d'écran. Sous
 * 640 px, où rien ne se lit au survol, le sigle cède la place à des mots : « manque : contrôler », « 2/4 temps ».
 */
function Crac({ objection }: { objection: Objection }) {
  const manquants = TEMPS.filter((t) => !objection[t.nom].trim());
  const titre = manquants.length ? `Manque : ${manquants.map((t) => t.verbe).join(', ')}` : '4 temps sur 4 remplis';
  const enMots = manquants.length === 1 ? `manque : ${manquants[0]!.verbe}` : `${4 - manquants.length}/4 temps`;
  return (
    <span className="font-mono text-xs">
      <span aria-hidden="true" className={`text-sm font-sans sm:hidden ${manquants.length ? 'text-encre-2' : 'text-encre-3'}`}>
        {enMots}
      </span>
      <span aria-hidden="true" title={titre} className="inline-flex max-sm:hidden">
        {TEMPS.map((t) => (
          <span key={t.nom} className={objection[t.nom].trim() ? 'text-encre' : 'text-encre-3'}>
            {t.lettre}
          </span>
        ))}
      </span>
      <span className="sr-only">
        {4 - manquants.length} temps sur 4 remplis
        {manquants.length ? `, manque : ${manquants.map((t) => t.verbe).join(', ')}` : ''}
      </span>
    </span>
  );
}

function Chiffres({ chiffres }: { chiffres: ChiffresObjection | undefined }) {
  if (!chiffres || chiffres.apparitions === 0) return <span className="text-sm text-encre-3">pas encore entendue</span>;
  return (
    <span className="text-sm text-encre-3">
      levée <span className="font-mono">{chiffres.levees}</span> sur <span className="font-mono">{chiffres.apparitions}</span>
      {chiffres.temps ? ` · coince à ${VERBE_TEMPS[chiffres.temps] ?? chiffres.temps}` : ''}
    </span>
  );
}

/**
 * Objections connues (une ligne dépliable chacune), formulaire de création en tête de liste (N), objections
 * archivées en bas. Échap (hors champ) referme l'objection ouverte ; ?objection=id l'ouvre et l'amène à l'écran.
 * L'ordre de la liste est celui dans lequel Mina reçoit les objections : ↑ et ↓ au bout de chaque ligne, ou
 * Ctrl ↑ et Ctrl ↓ quand le focus est sur une objection, la déplacent d'un rang ; le focus la suit.
 */
export function ListeObjections({
  entrepriseId,
  actives,
  archivees,
  chiffres,
  ouverteInitiale,
}: {
  entrepriseId: string;
  actives: Objection[];
  archivees: Objection[];
  chiffres: Record<string, ChiffresObjection>;
  ouverteInitiale: string | null;
}) {
  const vide = actives.length === 0;
  const [ouverte, setOuverte] = useState<string | null>(() => (actives.some((o) => o.id === ouverteInitiale) ? ouverteInitiale : null));
  const [nouvelle, setNouvelle] = useState(vide);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const formulaireOuvert = nouvelle || vide;

  // Arrivée depuis l'analyse : l'objection demandée vient à l'écran, le focus sur sa ligne.
  const initiale = useRef(ouverte);
  useEffect(() => {
    if (!initiale.current) return;
    const ligne = document.getElementById(`objection-${initiale.current}`);
    ligne?.scrollIntoView({ block: 'start' });
    ligne?.querySelector('summary')?.focus({ preventScroll: true });
  }, []);

  const refermer = () => {
    const id = ouverte;
    setOuverte(null);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`#objection-${id} summary`)?.focus());
  };
  useRaccourci({ touche: 'Escape', libelle: 'Refermer l’objection ouverte', actif: ouverte !== null, action: refermer });

  const ouvrirNouvelle = () => {
    setNouvelle(true);
    setAnnonce(null);
    requestAnimationFrame(() => document.getElementById('nouvelle-libelle')?.focus());
  };
  const fermerNouvelle = useCallback(() => {
    setNouvelle(false);
    requestAnimationFrame(() => bouton.current?.focus());
  }, []);
  const ajoutee = useCallback((message: string) => {
    setNouvelle(false);
    setAnnonce(message);
  }, []);
  const enregistree = useCallback((message: string) => setAnnonce(message), []);

  const [deplacement, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  // Après un déplacement, la liste revient du serveur dans le nouvel ordre : le focus retrouve alors l'objection.
  const ordre = actives.map((o) => o.id).join(',');
  const [suivi, setSuivi] = useState<{ id: string; sens: 'monter' | 'descendre'; bouton: boolean; avant: string } | null>(null);
  const suiviTraite = useRef<typeof suivi>(null);
  useEffect(() => {
    if (!suivi || suiviTraite.current === suivi || ordre === suivi.avant) return;
    suiviTraite.current = suivi;
    const ligne = document.getElementById(`objection-${suivi.id}`);
    // Les flèches de bout de ligne (dès 640 px) ou « Monter » et « Descendre » du panneau (en dessous) : celles qu'on voit.
    const bouton = suivi.bouton
      ? [...(ligne?.querySelectorAll<HTMLButtonElement>(`[data-deplacer="${suivi.sens}"]:not(:disabled)`) ?? [])].find((b) => b.offsetParent !== null)
      : null;
    (bouton ?? ligne?.querySelector('summary'))?.focus();
  }, [ordre, suivi]);

  const deplacer = (o: Objection, sens: 'monter' | 'descendre', depuisBouton: boolean) =>
    demarrer(async () => {
      setErreur(null);
      try {
        const resultat = await deplacerObjection(entrepriseId, o.id, sens);
        if (!resultat.ok) return setErreur(resultat.raison);
        setSuivi({ id: o.id, sens, bouton: depuisBouton, avant: ordre });
        setAnnonce(`« ${o.libelle} » est en position ${resultat.position} sur ${actives.length}.`);
      } catch {
        setErreur('Le déplacement a échoué : réessaie.');
      }
    });

  /** L'objection qui a le focus (sa ligne, ses flèches, son formulaire hors des champs). */
  const objectionFocalisee = () => {
    const id = document.activeElement?.closest<HTMLElement>('[data-objection]')?.dataset.objection;
    return actives.find((o) => o.id === id);
  };
  useRaccourcis(
    (['monter', 'descendre'] as const).map((sens) => ({
      touche: sens === 'monter' ? 'ArrowUp' : 'ArrowDown',
      ctrl: true,
      libelle: sens === 'monter' ? 'Monter l’objection' : 'Descendre l’objection',
      actif: actives.length > 1 && !deplacement,
      action: () => {
        const o = objectionFocalisee();
        if (!o) return false;
        const rang = actives.indexOf(o);
        if (sens === 'monter' ? rang === 0 : rang === actives.length - 1) return;
        deplacer(o, sens, false);
      },
    })),
  );

  return (
    <div className="grid gap-12">
      <section aria-labelledby="titre-objections">
        <TitreSection
          id="titre-objections"
          compte={actives.length}
          action={
            <Action ref={bouton} ton="fort" touche="N" raccourci="n" aria-expanded={formulaireOuvert} onClick={ouvrirNouvelle} className="-mr-1.5">
              Nouvelle objection
            </Action>
          }
        >
          Objections connues
        </TitreSection>

        <p role="status" className="text-sm text-encre-3 [&:not(:empty)]:pt-3">
          {annonce}
        </p>
        {erreur ? (
          <p role="alert" className="mt-3 rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
            {erreur}
          </p>
        ) : null}

        {formulaireOuvert ? (
          <div className="border-b border-filet pt-4">
            <h3 className="text-md font-semibold">Nouvelle objection</h3>
            <FormulaireObjection entrepriseId={entrepriseId} onSucces={ajoutee} {...(vide ? {} : { onAnnuler: fermerNouvelle })} />
          </div>
        ) : null}

        {vide ? (
          <EtatVide titre="Aucune objection préparée.">
            Commence par celles que tu entends le plus : « ça ne m’intéresse pas », « c’est combien ? », « envoyez-moi un mail ».
          </EtatVide>
        ) : (
          <ul>
            {actives.map((o, rang) => {
              const estOuverte = ouverte === o.id;
              return (
                <li
                  key={o.id}
                  id={`objection-${o.id}`}
                  data-objection={o.id}
                  className="flex scroll-mt-[calc(var(--hauteur-barre)+16px)] items-start gap-x-2 border-b border-filet"
                >
                  <details
                    className="min-w-0 flex-1"
                    open={estOuverte}
                    onToggle={(ev) => {
                      const ouvert = ev.currentTarget.open;
                      setOuverte((cur) => (ouvert ? o.id : cur === o.id ? null : cur));
                    }}
                  >
                    <summary
                      aria-keyshortcuts={actives.length > 1 ? 'Control+ArrowUp Control+ArrowDown' : undefined}
                      className="flex min-h-[38px] cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-0.5 py-2 transition-colors duration-100 hover:bg-survol focus-interne pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                      <Chevron ouvert={estOuverte} className="stroke-encre-3" />
                      <span className="min-w-0 flex-1 font-medium">{o.libelle}</span>
                      <Crac objection={o} />
                      <span className="w-full pl-5 sm:w-auto sm:min-w-[16rem] sm:pl-0 sm:text-right">
                        <Chiffres chiffres={chiffres[o.id]} />
                      </span>
                    </summary>
                    <div className="pl-5 max-sm:pl-0">
                      {/* Sous 640 px, déplacer se fait depuis le panneau déplié : la ligne garde toute sa largeur. */}
                      {actives.length > 1 ? (
                        <div className="-mx-1.5 flex gap-x-2 pt-2 sm:hidden">
                          <Action
                            ton="discret"
                            data-deplacer="monter"
                            aria-label={`Monter « ${o.libelle} »`}
                            disabled={rang === 0 || deplacement}
                            onClick={() => deplacer(o, 'monter', true)}
                          >
                            Monter
                          </Action>
                          <Action
                            ton="discret"
                            data-deplacer="descendre"
                            aria-label={`Descendre « ${o.libelle} »`}
                            disabled={rang === actives.length - 1 || deplacement}
                            onClick={() => deplacer(o, 'descendre', true)}
                          >
                            Descendre
                          </Action>
                        </div>
                      ) : null}
                      <FormulaireObjection
                        entrepriseId={entrepriseId}
                        objection={o}
                        onSucces={enregistree}
                        archive={
                          <BoutonArchive
                            archivee={false}
                            nom={o.libelle}
                            action={async () => {
                              const resultat = await basculerArchiveObjection(entrepriseId, o.id, true);
                              if (resultat.ok) {
                                setOuverte((cur) => (cur === o.id ? null : cur));
                                setAnnonce(`« ${o.libelle} » est archivée : elle reste dans la liste des archivées.`);
                              }
                              return resultat;
                            }}
                          />
                        }
                      />
                    </div>
                  </details>
                  {actives.length > 1 ? (
                    <span className="flex shrink-0 pt-px max-sm:hidden pointer-coarse:gap-x-2">
                      <Action
                        ton="discret"
                        className="text-base"
                        data-deplacer="monter"
                        aria-label={`Monter « ${o.libelle} »`}
                        disabled={rang === 0 || deplacement}
                        onClick={() => deplacer(o, 'monter', true)}
                      >
                        <Chevron direction="bas" className="rotate-180 stroke-current" />
                      </Action>
                      <Action
                        ton="discret"
                        className="text-base"
                        data-deplacer="descendre"
                        aria-label={`Descendre « ${o.libelle} »`}
                        disabled={rang === actives.length - 1 || deplacement}
                        onClick={() => deplacer(o, 'descendre', true)}
                      >
                        <Chevron direction="bas" className="stroke-current" />
                      </Action>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {archivees.length > 0 ? (
        <section aria-labelledby="titre-archivees">
          <TitreSection id="titre-archivees" compte={archivees.length}>
            Archivées
          </TitreSection>
          <ul>
            {archivees.map((o) => (
              <li key={o.id} className="flex min-h-[38px] flex-wrap items-center gap-x-4 border-b border-filet py-1 text-encre-3">
                <span className="min-w-0 flex-1">{o.libelle}</span>
                <BoutonArchive
                  archivee
                  nom={o.libelle}
                  action={async () => {
                    const resultat = await basculerArchiveObjection(entrepriseId, o.id, false);
                    if (resultat.ok) setAnnonce(`« ${o.libelle} » est de nouveau dans les objections connues.`);
                    return resultat;
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
