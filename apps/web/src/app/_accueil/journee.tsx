'use client';

import { LIBELLES_ISSUES } from '@autocalled/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo, useMemo, useRef, useState } from 'react';
import { Action, LienAction } from '@/components/action';
import { NavigationListe } from '@/components/clavier';
import { useLigne } from '@/components/etat-ligne-telephone';
import { dateCourte, duree, etatAppel, heure, LIGNES_COURTES, prenom, type EtatAppelAffiche } from '@/components/format-appel';
import {
  Cellule,
  CelluleEnTete,
  EnTeteTable,
  EtatVide,
  Filtre,
  Filtres,
  GlypheEtape,
  LienLigne,
  LigneTable,
  PleineLargeur,
  Recherche,
  TableDense,
} from '@/components/ui';
import { lienAvec } from '@/components/url';
import type { AppelDuJour, CampagneJour, ResultatRecherche } from '@/lib/accueil';
import { bilanJournee, CLES_FILTRE, comptesFiltres, estSimule, filtrerAppels, lireFiltres, normaliser, type CleFiltre, type EtatFiltres } from './filtres';
import { bornesFrise, graduations, minutesParis, position, resumeFrise, traitFrise, type Trait } from './frise';
import { useMinute } from './minute';

/**
 * La journée (frise et campagnes du jour) et le tableau des appels du jour. Tout est déjà chargé : filtres et
 * recherche instantanée travaillent en mémoire, l'URL suit par window.history.replaceState (jamais
 * router.replace, qui relancerait la page). Seule Entrée, à partir de 3 caractères, cherche aussi dans les
 * transcriptions (?q=, côté serveur).
 */

const COLONNES = '52px 230px 130px 200px minmax(0,1fr) 44px';
const DIX_MINUTES = 10 * 60 * 1000;

const TONS: Record<EtatAppelAffiche['ton'], string> = {
  antenne: 'text-antenne',
  alerte: 'text-alerte',
  encre: 'text-encre',
  'encre-2': 'text-encre-2',
  'encre-3': 'text-encre-3',
};

const LIBELLES_FILTRE: Record<CleFiltre, string> = { ...LIBELLES_ISSUES, 'sans-bilan': 'Sans bilan' };

const STATUTS: Record<CampagneJour['statut'], { libelle: string; classe: string }> = {
  prete: { libelle: 'prête', classe: 'text-encre-2' },
  // Pas d'antenne : une campagne en cours peut être entre deux appels ; l'appel vivant a sa bande et son trait.
  'en-cours': { libelle: 'en cours', classe: 'text-encre' },
  'en-pause': { libelle: 'suspendue', classe: 'text-encre-2' },
  terminee: { libelle: 'terminée', classe: 'text-encre-3' },
};

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);

export function Journee({
  appels,
  campagnes,
  maintenant: maintenantServeur,
  filtres: filtresUrl,
  recherche,
  texteInitial,
}: {
  appels: AppelDuJour[];
  campagnes: CampagneJour[];
  maintenant: string;
  filtres: { issue?: string | null; simules?: string | null };
  recherche: { q: string; resultats: ResultatRecherche[] } | null;
  texteInitial: string;
}) {
  const router = useRouter();
  const maintenant = useMinute(Date.parse(maintenantServeur));
  const releve = useLigne();
  const idVivant = releve.etat === 'en-appel' && releve.ligne === 'telephone' ? releve.appelId : null;
  const ligneRelevee = releve.etat !== 'releve';

  // Filtres locaux, recalés sur l'URL quand la page est relue (retour, rafraîchissement).
  const depuisUrl = lireFiltres(filtresUrl);
  const [filtres, setFiltres] = useState<EtatFiltres>(depuisUrl);
  const [urlVue, setUrlVue] = useState(`${depuisUrl.issue}|${depuisUrl.simules}`);
  if (`${depuisUrl.issue}|${depuisUrl.simules}` !== urlVue) {
    setUrlVue(`${depuisUrl.issue}|${depuisUrl.simules}`);
    setFiltres(depuisUrl);
  }
  const [texte, setTexte] = useState(texteInitial);
  const [texteVu, setTexteVu] = useState(texteInitial);
  if (texteInitial !== texteVu) {
    setTexteVu(texteInitial);
    setTexte(texteInitial);
  }
  const [cleRecherche, setCleRecherche] = useState(0);

  const appliquer = (f: EtatFiltres) => {
    setFiltres(f);
    const parametres = Object.fromEntries(new URLSearchParams(window.location.search));
    window.history.replaceState(null, '', lienAvec(window.location.pathname, parametres, { issue: f.issue, simules: f.simules ? '1' : null }));
  };

  const comptes = useMemo(() => comptesFiltres(appels), [appels]);
  const serveurApplique = recherche !== null && normaliser(texte.trim()) === normaliser(recherche.q);
  const trouves = useMemo(() => (serveurApplique && recherche ? new Set(recherche.resultats.map((r) => r.id)) : null), [serveurApplique, recherche]);
  const extraits = useMemo(
    () => new Map(serveurApplique && recherche ? recherche.resultats.flatMap((r) => (r.extrait ? [[r.id, r.extrait] as const] : [])) : []),
    [serveurApplique, recherche],
  );

  const visibles = useMemo(() => {
    const liste = filtrerAppels(appels, { ...filtres, texte, trouves });
    // L'appel vivant, épinglé en tête.
    const i = idVivant ? liste.findIndex((a) => a.id === idVivant) : -1;
    return i > 0 ? [liste[i]!, ...liste.slice(0, i), ...liste.slice(i + 1)] : liste;
  }, [appels, filtres, texte, trouves, idVivant]);

  const filtreActif = filtres.issue !== null || filtres.simules || texte.trim() !== '';
  const totalVue = filtres.simules ? comptes.simules : comptes.tous;

  const effacer = () => {
    setTexte('');
    setCleRecherche((c) => c + 1);
    if (recherche) {
      setFiltres({ issue: null, simules: false });
      router.replace('/', { scroll: false });
    } else appliquer({ issue: null, simules: false });
  };

  // Survol croisé frise ↔ tableau, par attributs posés à la main (aucun rendu pour 100 lignes).
  const tableau = useRef<HTMLDivElement>(null);
  const frise = useRef<HTMLDivElement>(null);
  const survolerAppel = (id: string | null) => {
    for (const el of document.querySelectorAll('[data-survol]')) el.removeAttribute('data-survol');
    if (!id) return;
    document.getElementById(`appel-${id}`)?.setAttribute('data-survol', '');
    frise.current?.querySelector(`[data-trait="${id}"]`)?.setAttribute('data-survol', '');
  };
  const selectionnerAppel = (id: string) => {
    const ligne = document.getElementById(`appel-${id}`);
    if (!ligne) return;
    for (const l of tableau.current?.querySelectorAll('[data-selectionnee]') ?? []) l.removeAttribute('data-selectionnee');
    ligne.setAttribute('data-selectionnee', '');
    ligne.querySelector<HTMLAnchorElement>('[data-lien-ligne]')?.focus({ preventScroll: true });
    ligne.scrollIntoView({ block: 'nearest' });
  };

  const base = useMemo(() => appels.filter((a) => estSimule(a) === filtres.simules), [appels, filtres.simules]);
  const idsVisibles = useMemo(() => new Set(visibles.map((a) => a.id)), [visibles]);

  return (
    <>
      <PleineLargeur as="section" aria-label="Journée" className="mt-[18px] grid gap-2 border-y border-filet bg-surface pt-3.5 pb-3">
        <EnTeteJournee appels={appels} campagnes={campagnes} />
        <Frise
          appels={base}
          idVivant={idVivant}
          maintenant={maintenant}
          attenues={filtreActif ? idsVisibles : null}
          conteneur={frise}
          onSurvol={survolerAppel}
          onChoix={selectionnerAppel}
        />
        <p className="text-sm text-encre-3 sm:hidden">Hauteur : étape atteinte du script · blanc : rendez-vous pris</p>
      </PleineLargeur>

      <section aria-labelledby="titre-appels-du-jour" className="pt-3.5">
        <h2 id="titre-appels-du-jour" className="sr-only">
          Appels du jour
        </h2>
        {appels.length === 0 ? (
          <EtatVide titre="Aucun appel aujourd’hui">Les appels de la journée s’afficheront ici, du plus récent au plus ancien.</EtatVide>
        ) : (
          <>
            <div className="flex items-start gap-x-6 gap-y-3 pb-2.5 max-sm:flex-col-reverse">
              <Filtres libelle="Filtrer par issue" className="min-w-0 flex-1">
                <Filtre actif={filtres.issue === null && !filtres.simules} compte={comptes.tous} onClick={() => appliquer({ issue: null, simules: false })}>
                  Tous
                </Filtre>
                {CLES_FILTRE.map((cle) => (
                  <Filtre
                    key={cle}
                    actif={filtres.issue === cle}
                    compte={comptes.parCle[cle]}
                    onClick={() => appliquer({ issue: filtres.issue === cle ? null : cle, simules: false })}
                  >
                    {LIBELLES_FILTRE[cle]}
                  </Filtre>
                ))}
                <Filtre actif={filtres.simules} compte={comptes.simules} onClick={() => appliquer({ issue: null, simules: !filtres.simules })}>
                  Simulés
                </Filtre>
              </Filtres>
              {/* Entrée cherche dans les transcriptions à partir de 3 caractères ; en deçà, rien ne part. */}
              <Recherche
                key={cleRecherche}
                action="/"
                valeur={texteInitial}
                conserver={{ issue: filtres.issue ?? undefined, simules: filtres.simules ? '1' : undefined }}
                instantane={setTexte}
                longueurMin={3}
                scroll={false}
                placeholder="Prospect, société ou phrase dite"
                libelle="Chercher dans les appels du jour (Entrée : aussi dans les transcriptions)"
                className="w-full shrink-0 sm:w-[300px]"
              />
            </div>
            <p role="status" className="min-h-0 text-sm text-encre-3">
              {filtreActif ? (
                <span className="flex flex-wrap items-center gap-x-1 pb-1.5">
                  <span className="font-mono">{visibles.length}</span> {pluriel(visibles.length, 'appel', 'appels')} sur{' '}
                  <span className="font-mono">{totalVue}</span>
                  {serveurApplique ? ' · transcriptions comprises' : texte.trim().length >= 3 ? ' · Entrée pour chercher aussi dans les transcriptions' : ''}
                  {' · '}
                  <Action ton="discret" className="-ml-1.5 h-7" onClick={effacer}>
                    Effacer
                  </Action>
                </span>
              ) : null}
            </p>
            {visibles.length === 0 ? (
              texte.trim() && filtres.issue === null && !filtres.simules ? (
                <EtatVide
                  forme="filtre"
                  titre={`Aucun appel aujourd’hui ne contient « ${texte.trim()} ».`}
                  action={<LienAction href={`/appels?q=${encodeURIComponent(texte.trim())}`}>Chercher dans tous les appels</LienAction>}
                />
              ) : (
                <EtatVide
                  forme="filtre"
                  titre="Aucun appel du jour ne correspond à ce filtre."
                  action={
                    <Action ton="normal" onClick={effacer}>
                      Effacer les filtres
                    </Action>
                  }
                />
              )
            ) : (
              <NavigationListe memoriser="accueil">
                <div
                  ref={tableau}
                  onMouseOver={(e) => {
                    const ligne = e.target instanceof Element ? e.target.closest('[data-ligne]') : null;
                    survolerAppel(ligne?.id.startsWith('appel-') ? ligne.id.slice(6) : null);
                  }}
                  onMouseLeave={() => survolerAppel(null)}
                >
                  <TableDense libelle="Appels du jour" colonnes={COLONNES}>
                    <EnTeteTable>
                      <CelluleEnTete>Heure</CelluleEnTete>
                      <CelluleEnTete>Prospect</CelluleEnTete>
                      <CelluleEnTete masqueeMobile>Entreprise</CelluleEnTete>
                      <CelluleEnTete>Issue</CelluleEnTete>
                      <CelluleEnTete masqueeMobile>Résumé</CelluleEnTete>
                      <CelluleEnTete align="droite">Durée</CelluleEnTete>
                    </EnTeteTable>
                    <div role="rowgroup">
                      {visibles.map((a) => (
                        <LigneAppel
                          key={a.id}
                          appel={a}
                          vivant={a.id === idVivant}
                          ligneRelevee={ligneRelevee}
                          maintenant={maintenant}
                          extrait={extraits.get(a.id) ?? null}
                        />
                      ))}
                    </div>
                  </TableDense>
                </div>
              </NavigationListe>
            )}
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ en-tête de la journée */

function EnTeteJournee({ appels, campagnes }: { appels: AppelDuJour[]; campagnes: CampagneJour[] }) {
  const b = bilanJournee(appels);
  const montrees = campagnes.slice(0, 5);
  const autres = campagnes.length - montrees.length;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm text-encre-3">
        <p>
          <span className="font-semibold text-encre">Aujourd’hui</span>
          {' · '}
          {b.total === 0 ? (
            'aucun appel pour l’instant'
          ) : (
            <>
              <span className="font-mono">{b.total}</span> {pluriel(b.total, 'appel', 'appels')} depuis <span className="font-mono">{b.premier ? heure(b.premier) : ''}</span>
              {' · '}
              <span className="font-mono">{b.conversations}</span> {pluriel(b.conversations, 'conversation', 'conversations')}
              {' · '}
              <span className="font-mono">{b.rendezVous}</span> rendez-vous
            </>
          )}
          {b.simules > 0 ? (
            <>
              {' · '}
              <span className="font-mono">{b.simules}</span> {pluriel(b.simules, 'appel simulé', 'appels simulés')} à part
            </>
          ) : null}
        </p>
        <p className="max-sm:hidden">Hauteur : étape atteinte du script · blanc : rendez-vous pris</p>
      </div>
      {montrees.length > 0 ? (
        <ul className="grid gap-0.5 text-sm text-encre-3">
          {montrees.map((c) => {
            const statut = STATUTS[c.statut];
            return (
              <li key={c.id}>
                <Link href={`/campagnes/${c.id}`} className="decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
                  Campagne du <span className="font-mono">{dateCourte(c.creeLe).split(' ')[0]}</span> · {c.entreprise} · {c.version} ·{' '}
                  {LIGNES_COURTES[c.ligne] ?? c.ligne} ·{' '}
                  <span className="font-mono">
                    {c.comptes.traites}/{c.comptes.total}
                  </span>{' '}
                  traités · <span className={statut.classe}>{statut.libelle}</span>
                </Link>
              </li>
            );
          })}
          {autres > 0 ? (
            <li>
              et <span className="font-mono">{autres}</span> {pluriel(autres, 'autre campagne ouverte', 'autres campagnes ouvertes')}, dans chaque entreprise
            </li>
          ) : null}
        </ul>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ frise */

const CLASSES_TRAIT: Record<Trait['forme'], string> = {
  normal: 'bg-trait',
  'rendez-vous': 'bg-encre',
  // Point creux centré sur l'heure de l'appel : un échec n'a ni durée ni étape.
  echec: '-translate-x-1/2 rounded-full border-[1.5px] border-alerte',
  pointille: 'border border-dashed border-trait',
  vivant: 'bg-antenne',
};

function Frise({
  appels,
  idVivant,
  maintenant,
  attenues,
  conteneur,
  onSurvol,
  onChoix,
}: {
  appels: AppelDuJour[];
  idVivant: string | null;
  maintenant: number;
  attenues: ReadonlySet<string> | null;
  conteneur: React.RefObject<HTMLDivElement | null>;
  onSurvol: (id: string | null) => void;
  onChoix: (id: string) => void;
}) {
  const minute = minutesParis(maintenant);
  const bornes = useMemo(() => bornesFrise(appels, minute), [appels, minute]);
  const traits = useMemo(() => appels.map((a) => traitFrise(a, bornes, { vivant: a.id === idVivant })), [appels, bornes, idVivant]);
  const heures = graduations(bornes);
  const vivant = idVivant ? appels.find((a) => a.id === idVivant) : undefined;

  // Le trait le plus proche du pointeur (6 px de tolérance) : un trait de 2 px ne se vise pas.
  const traitSous = (e: React.MouseEvent<HTMLDivElement>): string | null => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0) return null;
    const x = ((e.clientX - r.left) / r.width) * 100;
    const tolerance = (6 / r.width) * 100;
    let meilleur: { id: string; distance: number } | null = null;
    for (const t of traits) {
      const fin = t.gauche + Math.max(t.largeur, 0);
      const distance = x < t.gauche ? t.gauche - x : x > fin ? x - fin : 0;
      if (distance <= tolerance && (!meilleur || distance < meilleur.distance)) meilleur = { id: t.id, distance };
    }
    return meilleur?.id ?? null;
  };

  return (
    <>
      <div aria-hidden="true" className="relative h-4">
        {heures.map((g) => (
          <span key={g.minutes} className={`absolute top-0 font-mono text-2xs text-encre-3 ${g.secondaire ? 'max-sm:hidden' : ''}`} style={{ left: `${g.position}%` }}>
            {g.libelle}
          </span>
        ))}
      </div>
      <div
        ref={conteneur}
        aria-hidden="true"
        className="relative h-12 border-b border-filet-2 [--trait-min:1px] sm:[--trait-min:2px]"
        onMouseMove={(e) => {
          const id = traitSous(e);
          e.currentTarget.style.cursor = id ? 'pointer' : '';
          onSurvol(id);
        }}
        onMouseLeave={() => onSurvol(null)}
        onClick={(e) => {
          const id = traitSous(e);
          if (id) onChoix(id);
        }}
      >
        {heures.map((g) => (
          <div key={g.minutes} className="absolute inset-y-0 w-px bg-grille" style={{ left: `${g.position}%` }} />
        ))}
        {maintenant > 0 && minute >= bornes.debut && minute <= bornes.fin ? (
          // Maintenant : en pointillé, pour ne pas se confondre avec le trait d'un appel.
          <div className="absolute inset-y-0 border-l border-dashed border-trait" style={{ left: `${position(minute, bornes)}%` }} />
        ) : null}
        <Traits traits={traits} attenues={attenues} />
      </div>
      <p className="sr-only">{resumeFrise(appels, vivant ?? null)}</p>
    </>
  );
}

const Traits = memo(function Traits({ traits, attenues }: { traits: Trait[]; attenues: ReadonlySet<string> | null }) {
  return traits.map((t) => (
    <div
      key={t.id}
      data-trait={t.id}
      className={`absolute bottom-0 box-border data-survol:outline data-survol:outline-1 data-survol:outline-offset-1 data-survol:outline-encre-2 ${CLASSES_TRAIT[t.forme]} ${
        attenues && !attenues.has(t.id) ? 'opacity-35' : ''
      }`}
      style={{
        left: `${t.gauche}%`,
        width: t.forme === 'vivant' ? '5px' : t.forme === 'echec' ? '7px' : `max(var(--trait-min), ${t.largeur}%)`,
        height: t.forme === 'echec' ? '7px' : t.hauteur,
      }}
    />
  ));
});

/* ------------------------------------------------------------------ ligne du tableau */

const LigneAppel = memo(function LigneAppel({
  appel: a,
  vivant,
  ligneRelevee,
  maintenant,
  extrait,
}: {
  appel: AppelDuJour;
  vivant: boolean;
  ligneRelevee: boolean;
  maintenant: number;
  extrait: ResultatRecherche['extrait'];
}) {
  // Avant le premier relevé de la ligne, un appel téléphone ouvert depuis peu n'est ni vivant ni « resté ouvert ».
  const enAttente = !vivant && !ligneRelevee && a.statut === 'en-cours' && a.ligne === 'bluetooth' && maintenant - Date.parse(a.debutLe) < DIX_MINUTES;
  const etat: EtatAppelAffiche = vivant
    ? { cle: 'en-cours', libelle: 'En cours', ton: 'antenne' }
    : enAttente
      ? { cle: 'en-cours', libelle: 'Relevé de la ligne…', ton: 'encre-3' }
      : etatAppel({ ...a, conversationId: a.conversation ? 'oui' : null }, { libellePerso: a.libellePerso, maintenant: new Date(maintenant) });
  const glyphe =
    etat.cle === 'issue'
      ? 'bilan'
      : etat.cle === 'analyse'
        ? 'analyse'
        : etat.cle === 'pas-parti' || etat.cle === 'analyse-echec'
          ? 'echec'
          : vivant
            ? 'vivant'
            : 'sans-bilan';
  const qui = extrait ? (extrait.role === 'agent' ? 'Mina' : prenom(a.prospect)) : '';
  // Un appel non composé : l'erreur de la ligne, précédée de ce qu'elle veut dire pour l'opérateur.
  const detail = etat.detail ? (etat.cle === 'pas-parti' ? `La ligne n’a pas composé : ${etat.detail}` : etat.detail) : '';
  const resume = extrait ? `${qui} : ${extrait.avant}${extrait.terme}${extrait.apres}` : (a.resume ?? detail);
  const lieu = [a.prospect, a.societe].filter(Boolean).join(' · ');

  return (
    <LigneTable id={`appel-${a.id}`} etat={vivant ? 'vivante' : 'normale'} className="data-survol:bg-survol">
      <Cellule mono className="max-sm:order-1 max-sm:w-11">
        {heure(a.debutLe)}
      </Cellule>
      <Cellule tronquee titre={lieu} className="max-sm:order-2 max-sm:w-[calc(100%-112px)]">
        <LienLigne href={`/appels/${a.id}?depuis=%2F`} className="text-encre">
          {a.prospect}
        </LienLigne>
        {a.societe ? <span className="text-encre-3"> · {a.societe}</span> : null}
        {a.ligne === 'simulation' ? <span className="text-encre-3"> · simulé</span> : null}
      </Cellule>
      <Cellule attenuee tronquee titre={a.entreprise} masqueeMobile>
        {a.entreprise}
      </Cellule>
      <Cellule etat className={`flex items-center gap-2 max-sm:order-4 max-sm:ml-14 max-sm:max-w-[55%] ${TONS[etat.ton]}`}>
        <GlypheEtape etape={a.etapeAtteinte} nombre={a.nombreEtapes} etat={glyphe} rendezVous={etat.ton === 'encre' && etat.cle === 'issue'} />
        <span className="truncate" title={etat.detail}>
          {etat.libelle}
        </span>
      </Cellule>
      <Cellule attenuee tronquee titre={resume} className="max-sm:order-5 max-sm:flex-1">
        {extrait ? (
          <>
            <b className="font-semibold text-encre-2">{qui}</b> {extrait.avant}
            <mark className="rounded-[2px] bg-filet-2 text-encre">{extrait.terme}</mark>
            {extrait.apres}
          </>
        ) : (
          resume
        )}
      </Cellule>
      <Cellule mono align="droite" className="max-sm:order-3 max-sm:w-11 max-sm:text-right">
        {duree(a.dureeSecondes)}
      </Cellule>
    </LigneTable>
  );
});
