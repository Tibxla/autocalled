'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { lancerCampagne, suspendreCampagne } from '@/app/campagnes/actions';
import { useNomAssistante } from '@/components/assistante';
import { Action, LienAction } from '@/components/action';
import { BandeAppel, type IdentiteAppel } from '@/components/bande-appel';
import { useRaccourci } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { useLigne } from '@/components/etat-ligne-telephone';
import { chrono, dateCourte, duree, etatAppel, FUSEAU, heure, LIGNES_COURTES } from '@/components/format-appel';
import { estimation } from '@/components/garde-fous';
import { useHorloge } from '@/components/horloge';
import { GlypheEtape, PointCreux } from '@/components/ui';
import { useReconnexion } from '@/app/telephone/panneau-telephone';
import type { AppelDuJour, CampagneJour, EtatLigneServeur } from '@/lib/accueil';
import { ligneBloquee, type Situation } from './situation';
import { AxePiste } from './squelette-bande';

/**
 * Bande du haut de l'accueil : l'appel en cours (BandeAppel), ou la situation de la ligne et des campagnes
 * quand rien ne sonne. Toutes les situations gardent la forme de la bande vivante (rangée titre et gestes,
 * sous-titre centré, axe de la piste) : la frise ne saute pas quand un appel démarre. Jamais le mot « pont ».
 */

const lienAppel = (id: string) => `/appels/${id}?depuis=%2F`;

const FORMAT_RDV = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSEAU });

/** « Campagne du 29/09 · Atelier Vitrine · Script principal v3 · téléphone ». */
function identiteCampagne(c: CampagneJour): string {
  return [`Campagne du ${dateCourte(c.creeLe).split(' ')[0]}`, c.entreprise, c.version, LIGNES_COURTES[c.ligne] ?? c.ligne].join(' · ');
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export function BandeAccueil({
  situation,
  identiteFin,
  ligne,
  telephoneRecents,
  confirmationInitiale = false,
}: {
  situation: Situation;
  /** Identité complète (version, numéro masqué) de l'appel téléphone en analyse, pour garder la bande telle quelle. */
  identiteFin: IdentiteAppel | null;
  ligne: EtatLigneServeur;
  telephoneRecents: { derniereHeure: number; dernieres24h: number };
  /** Démonstration seulement : la confirmation de Lancer ou Reprendre déjà ouverte. */
  confirmationInitiale?: boolean;
}) {
  // La ligne relevée par le navigateur devance le rendu serveur : un appel qui démarre s'affiche tout de
  // suite (le suivi de l'accueil demande aussitôt un rafraîchissement, qui apporte son identité).
  const releve = useLigne();
  const idClient = releve.etat === 'en-appel' && releve.ligne === 'telephone' ? releve.appelId : null;
  let s = situation;
  if (idClient && !(s.type === 'appel' && s.appelId === idClient) && !(s.type === 'fin-appel' && s.appel.id === idClient)) {
    s = { type: 'appel', appelId: idClient, appel: null };
  }

  // L'appel téléphone vivant, puis en analyse, sous la même clé et à la même place : le fil survit.
  const bande =
    s.type === 'appel' && s.appelId
      ? {
          appelId: s.appelId,
          statut: 'en-cours' as const,
          identite: s.appel
            ? {
                prospect: s.appel.prospect,
                societe: s.appel.societe,
                entreprise: s.appel.entreprise,
                version: s.appel.version,
                numeroMasque: s.appel.numeroMasque,
                lien: lienAppel(s.appel.id),
              }
            : null,
          debutLe: s.appel?.debutLe ?? null,
          finLe: null,
          conversation: s.appel?.conversation ?? false,
          etapes: s.appel?.etapes ?? null,
        }
      : s.type === 'fin-appel' && s.appel.statut === 'traitement' && s.appel.ligne === 'bluetooth'
        ? {
            appelId: s.appel.id,
            statut: 'traitement' as const,
            identite: identiteFin ?? {
              prospect: s.appel.prospect,
              societe: s.appel.societe,
              entreprise: s.appel.entreprise,
              lien: lienAppel(s.appel.id),
            },
            debutLe: s.appel.debutLe,
            finLe: s.appel.finLe,
            conversation: s.appel.conversation,
            etapes: null,
          }
        : null;

  return (
    <div className="grid min-h-[188px] grid-cols-1 content-start gap-3.5 max-sm:min-h-0">
      {bande ? (
        <BandeAppel
          key={bande.appelId}
          appelId={bande.appelId}
          variante="bande"
          condensee
          statut={bande.statut}
          {...(bande.identite ? { identite: bande.identite } : {})}
          {...(bande.debutLe ? { debutLe: bande.debutLe } : {})}
          finLe={bande.finLe}
          conversation={bande.conversation}
          etapes={bande.etapes}
        />
      ) : (
        <SansAppel situation={s} ligne={ligne} telephoneRecents={telephoneRecents} confirmationInitiale={confirmationInitiale} />
      )}
      {bande?.statut === 'traitement' && s.type === 'fin-appel' ? (
        <div className="-mx-1.5 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {s.bloquee ? <p className="text-sm text-alerte">L’analyse ne progresse plus.</p> : null}
          <LienEntree href={lienAppel(s.appel.id)}>Ouvrir l’appel</LienEntree>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ situations sans appel suivi */

function SansAppel({
  situation: s,
  ligne,
  telephoneRecents,
  confirmationInitiale,
}: {
  situation: Situation;
  ligne: EtatLigneServeur;
  telephoneRecents: { derniereHeure: number; dernieres24h: number };
  confirmationInitiale: boolean;
}) {
  switch (s.type) {
    case 'appel':
      return (
        <Cadre
          etiquette="Appel en cours"
          titre="En appel · téléphone"
          tonTitre="antenne"
          phrase="Le téléphone passerelle est en communication, sans appel d’Autocalled à suivre ici."
          actions={
            <LienAction ton="fort" href="/telephone">
              Ouvrir Téléphone
            </LienAction>
          }
        />
      );
    case 'ligne-coupee':
      return <LigneCoupee situation={s} />;
    case 'plafond':
      return (
        <Cadre
          etiquette="Ligne"
          titre={ligne.joignable && ligne.plafondJusqua ? `Plafond atteint · prochain appel à ${heure(new Date(ligne.plafondJusqua))}` : 'Plafond atteint'}
          tonTitre="alerte"
          {...(s.campagne ? { contexte: `${identiteCampagne(s.campagne)} · ${s.campagne.statut === 'en-cours' ? 'en cours' : 'suspendue'}` } : {})}
          phrase={s.phrase}
          actions={
            <LienAction ton="fort" href="/telephone">
              Ouvrir Téléphone
            </LienAction>
          }
        />
      );
    case 'fin-appel':
      return <FinAppel appel={s.appel} bloquee={s.bloquee} />;
    case 'campagne-entre-deux':
      return <EntreDeux campagne={s.campagne} ligne={ligne} />;
    case 'campagne-suspendue':
      return (
        <CampagneArretee
          campagne={s.campagne}
          reprise
          raison={s.raison?.texte ?? null}
          ligne={ligne}
          telephoneRecents={telephoneRecents}
          confirmationInitiale={confirmationInitiale}
        />
      );
    case 'campagne-prete':
      return (
        <CampagneArretee
          campagne={s.campagne}
          reprise={false}
          raison={null}
          ligne={ligne}
          telephoneRecents={telephoneRecents}
          confirmationInitiale={confirmationInitiale}
        />
      );
    case 'libre':
      return <Libre dernier={s.dernier} premiereUtilisation={s.premiereUtilisation} entrepriseSlug={s.entrepriseSlug} />;
  }
}

/**
 * Même squelette que la bande vivante : rangée 1 (titre de situation à gauche, gestes à droite), sous-titre
 * centré (contexte, phrase principale, détail), axe de la piste immobile. Sous 640 px : une colonne, les
 * gestes en pleine largeur après la phrase, sans touches.
 */
function Cadre({
  etiquette,
  titre,
  tonTitre = 'normal',
  contexte,
  phrase,
  taille,
  detail,
  tonDetail = 'discret',
  actions,
  sousActions,
}: {
  etiquette: string;
  titre: string;
  tonTitre?: 'normal' | 'alerte' | 'antenne';
  contexte?: React.ReactNode;
  phrase: React.ReactNode;
  taille?: 'grande' | 'normale' | 'longue';
  detail?: React.ReactNode;
  tonDetail?: 'discret' | 'alerte';
  actions?: React.ReactNode;
  sousActions?: React.ReactNode;
}) {
  const longueur = typeof phrase === 'string' ? phrase.length : 0;
  const t = taille ?? (longueur > 100 ? 'longue' : 'normale');
  const classeTaille = t === 'grande' ? 'text-3xl max-w-[34ch]' : t === 'longue' ? 'text-xl max-w-[60ch]' : 'text-2xl max-w-[48ch]';
  return (
    <section aria-label={etiquette} className="grid min-w-0 grid-cols-1 gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 max-sm:contents">
        {/* Alerte : le titre reste en encre, la brique ne porte que sur le point creux (l'antenne est au vivant seul). */}
        <h2 className={`text-lg font-semibold ${tonTitre === 'antenne' ? 'text-antenne' : 'text-encre'} max-sm:order-1 ${tonTitre === 'alerte' ? 'flex items-center gap-2.5' : ''}`}>
          {tonTitre === 'alerte' ? <PointCreux /> : null}
          {titre}
        </h2>
        {actions ? (
          <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:order-3 max-sm:mx-0 max-sm:grid max-sm:grid-cols-1 max-sm:[&_.touche]:hidden max-sm:[&>*]:h-11 max-sm:[&>*]:justify-center">
            {actions}
          </div>
        ) : null}
      </div>
      {sousActions ? <div className="grid gap-2 max-sm:order-4">{sousActions}</div> : null}
      <div className="flex min-h-[84px] flex-col items-center justify-end gap-1.5 pt-1.5 pb-0.5 text-center max-sm:order-2 max-sm:min-h-0">
        {contexte ? <p className="max-w-full text-lg text-encre-2 text-balance">{contexte}</p> : null}
        <div className={`font-medium tracking-[-0.01em] text-balance max-sm:text-xl ${classeTaille}`}>{phrase}</div>
        {detail ? <div className={`max-w-[72ch] text-md ${tonDetail === 'alerte' ? 'text-alerte' : 'text-encre-3'}`}>{detail}</div> : null}
      </div>
      <div className="max-sm:order-5">
        <AxePiste />
      </div>
    </section>
  );
}

/**
 * La ligne ne peut rien composer. Téléphone déconnecté : « Reconnecter le téléphone » relance la liaison
 * Bluetooth sans quitter l'accueil (personne n'est appelé : ni confirmation ni raccourci). Ligne injoignable :
 * le service ne répond pas, seul Téléphone aide.
 */
function LigneCoupee({ situation: s }: { situation: Extract<Situation, { type: 'ligne-coupee' }> }) {
  const reconnexion = useReconnexion();
  const deconnecte = s.raison === 'deconnecte';
  return (
    <Cadre
      etiquette="Ligne"
      titre={deconnecte ? 'Téléphone passerelle déconnecté' : 'Ligne injoignable'}
      tonTitre="alerte"
      {...(s.campagne ? { contexte: `${identiteCampagne(s.campagne)} · ${s.campagne.statut === 'en-cours' ? 'en cours' : 'suspendue'}` } : {})}
      phrase={
        deconnecte
          ? 'Hors de portée ou Bluetooth coupé : aucun appel ne peut partir par le téléphone.'
          : 'Aucun appel ne peut partir par le téléphone passerelle : le service de la ligne ne répond pas.'
      }
      {...(reconnexion.erreur ? { tonDetail: 'alerte' as const } : {})}
      detail={
        reconnexion.erreur ? (
          <span role="alert">{reconnexion.erreur}</span>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-center gap-x-3">
            La ligne navigateur et les appels simulés restent disponibles.
            {s.entrepriseSlug ? (
              <LienAction ton="discret" href={`/entreprises/${s.entrepriseSlug}/prospects`} className="-my-1.5">
                Ouvrir les prospects
              </LienAction>
            ) : null}
          </span>
        )
      }
      actions={
        <>
          {deconnecte ? (
            <Action ton="fort" enCours={reconnexion.enCours} libelleEnCours="Reconnexion…" disabled={reconnexion.enCours} onClick={reconnexion.lancer}>
              Reconnecter le téléphone
            </Action>
          ) : null}
          <LienAction ton={deconnecte ? 'normal' : 'fort'} href="/telephone">
            Ouvrir Téléphone
          </LienAction>
        </>
      }
    />
  );
}

/** Lien fort précédé de « Entrée » : Entrée l'ouvre quand le focus n'est nulle part ailleurs (sur la page). */
function LienEntree({ href, children }: { href: string; children: string }) {
  const lien = useRef<HTMLAnchorElement>(null);
  useRaccourci({
    touche: 'Enter',
    libelle: children,
    groupe: 'Page',
    action: () => {
      const actif = document.activeElement;
      if (actif && actif !== document.body && actif.id !== 'contenu') return false;
      lien.current?.click();
    },
  });
  return (
    <LienAction ref={lien} ton="fort" touche="Entrée" aria-keyshortcuts="Enter" href={href}>
      {children}
    </LienAction>
  );
}

/* ------------------------------------------------------------------ fin d'appel */

function FinAppel({ appel: a, bloquee }: { appel: AppelDuJour; bloquee: boolean }) {
  const qui = `${a.prospect}${a.societe ? `, ${a.societe}` : ''} · ${a.entreprise}${a.ligne === 'simulation' ? ' · simulé' : ''}`;

  if (a.statut === 'traitement') {
    return (
      <Cadre
        etiquette="Dernier appel"
        titre="Ligne libre"
        contexte={`Appel terminé à ${heure(a.finLe ?? a.debutLe)} · ${qui}`}
        phrase={bloquee ? 'L’analyse ne progresse plus.' : <ChronoAnalyse depuis={a.finLe ?? a.debutLe} />}
        {...(bloquee ? { detail: 'Le bilan n’est pas arrivé : ouvre l’appel pour relancer le rapatriement.', tonDetail: 'alerte' as const } : {})}
        actions={<LienEntree href={lienAppel(a.id)}>Ouvrir l’appel</LienEntree>}
      />
    );
  }

  if (a.statut === 'echec') {
    const pasParti = !a.conversation;
    return (
      <Cadre
        etiquette="Dernier appel"
        titre="Ligne libre"
        contexte={`Appel de ${heure(a.debutLe)} · ${qui}`}
        phrase={
          <span className="text-encre-2">
            <PointCreux className="mr-3.5" />
            {pasParti ? `L’appel de ${a.prospect} n’est pas parti` : 'Analyse en échec'}
          </span>
        }
        {...(a.erreur ? { detail: a.erreur, tonDetail: 'alerte' as const } : {})}
        actions={<LienEntree href={lienAppel(a.id)}>Ouvrir l’appel</LienEntree>}
      />
    );
  }

  // Le bilan est tombé : le moment fort d'une démo.
  const etat = etatAppel(a, { libellePerso: a.libellePerso });
  const rdv = etat.ton === 'encre';
  const r = a.rendezVous;
  const quand = r ? `Visio ${FORMAT_RDV.format(new Date(r.debut))} à ${heure(r.debut)}` : null;
  return (
    <Cadre
      etiquette="Bilan du dernier appel"
      titre="Ligne libre"
      contexte={`Bilan de l’appel de ${heure(a.debutLe)} · ${qui}${a.dureeSecondes ? ` · ${duree(a.dureeSecondes)}` : ''}`}
      taille="grande"
      phrase={
        <span className="inline-flex items-end gap-4">
          <GlypheEtape etape={a.etapeAtteinte} nombre={a.nombreEtapes} rendezVous={rdv} hauteur={40} etat={etat.cle === 'issue' ? 'bilan' : 'sans-bilan'} />
          <span className={rdv ? 'text-encre' : 'text-encre-2'}>{etat.libelle}</span>
        </span>
      }
      detail={
        a.resume || r ? (
          <div className="grid justify-items-center gap-1.5">
            {a.resume ? <p className="line-clamp-2 max-w-[68ch] text-base text-encre-2">{a.resume}</p> : null}
            {r && quand ? (
              r.statut === 'echec' ? (
                <p className="flex flex-wrap items-center justify-center gap-x-3 text-md text-alerte">
                  {quand} : création de l’événement Google échouée
                  <LienAction ton="discret" href="/reglages" className="-my-1.5">
                    Voir dans Réglages
                  </LienAction>
                </p>
              ) : (
                <p className="text-md text-encre">
                  {quand}
                  {r.statut === 'cree' ? ', dans l’agenda' : ' : création de l’événement dans l’agenda…'}
                </p>
              )
            ) : null}
          </div>
        ) : undefined
      }
      actions={<LienEntree href={lienAppel(a.id)}>Ouvrir le bilan</LienEntree>}
    />
  );
}

/** « Rapatriement et analyse du bilan… 00:23 », le chrono partant de la fin de l'appel. */
function ChronoAnalyse({ depuis }: { depuis: string }) {
  const maintenant = useHorloge();
  return (
    <span>
      Rapatriement et analyse du bilan…{' '}
      <span className="font-mono text-encre-3">{maintenant > 0 ? chrono(maintenant - Date.parse(depuis)) : '--:--'}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ campagnes */

const MESSAGE_CONCURRENCE = 'La campagne a changé d’état entre-temps.';

function EntreDeux({ campagne: c, ligne }: { campagne: CampagneJour; ligne: EtatLigneServeur }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const suspendre = () =>
    demarrer(async () => {
      setErreur(null);
      try {
        await suspendreCampagne(c.id);
      } catch {
        setErreur(MESSAGE_CONCURRENCE);
      }
      router.refresh();
    });
  const pause = c.ligne === 'bluetooth' && ligne.joignable && ligne.reglages ? ligne.reglages.pauseEntreAppelsS : null;
  return (
    <Cadre
      etiquette="Campagne en cours"
      titre="Entre deux appels"
      contexte={identiteCampagne(c)}
      phrase={
        c.prochain
          ? `Suivant : ${c.prochain.nom}${c.prochain.societe ? `, ${c.prochain.societe}` : ''}`
          : 'Plus aucun prospect à appeler : la campagne se termine.'
      }
      detail={
        <>
          <span className="font-mono">{c.comptes.traites}</span> traités sur <span className="font-mono">{c.comptes.total}</span>
          {pause !== null ? (
            <>
              {' '}
              · pause de <span className="font-mono">{pause}</span> s entre deux appels, réglée sur{' '}
              <Link href="/telephone" className="decoration-souligne underline-offset-4 hover:underline">
                Téléphone
              </Link>
            </>
          ) : null}
        </>
      }
      actions={
        <>
          <Action onClick={suspendre} enCours={enCours} libelleEnCours="Suspension…" disabled={enCours} aria-describedby={`aide-suspendre-${c.id}`}>
            Suspendre
          </Action>
          <LienAction href={`/campagnes/${c.id}`}>Ouvrir la régie</LienAction>
        </>
      }
      sousActions={
        <>
          <p id={`aide-suspendre-${c.id}`} className="text-sm text-encre-3 sm:text-right">
            Suspendre : l’appel en cours va à son terme, aucun autre ne part.
          </p>
          {erreur ? (
            <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
              {erreur}
            </p>
          ) : null}
        </>
      }
    />
  );
}

/** Campagne prête (Lancer) ou suspendue (Reprendre). Au téléphone, toujours par une Confirmation. */
function CampagneArretee({
  campagne: c,
  reprise,
  raison,
  ligne,
  telephoneRecents,
  confirmationInitiale,
}: {
  campagne: CampagneJour;
  reprise: boolean;
  raison: string | null;
  ligne: EtatLigneServeur;
  telephoneRecents: { derniereHeure: number; dernieres24h: number };
  confirmationInitiale: boolean;
}) {
  const router = useRouter();
  const confirmation = useConfirmation();
  const [ouverteAuDepart, setOuverteAuDepart] = useState(confirmationInitiale);
  const ouverte = confirmation.ouverte || ouverteAuDepart;
  const fermer = () => {
    setOuverteAuDepart(false);
    confirmation.fermer();
  };
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);

  const restants = c.comptes.aAppeler;
  const telephone = c.ligne === 'bluetooth';
  const simulation = c.ligne === 'simulation';
  const blocage = telephone ? ligneBloquee(ligne) : null;

  const lancer = () =>
    demarrer(async () => {
      setErreur(null);
      try {
        await lancerCampagne(c.id);
        fermer();
      } catch {
        setErreur(MESSAGE_CONCURRENCE);
      }
      router.refresh();
    });

  const libelle = reprise ? 'Reprendre' : simulation ? 'Lancer la simulation' : 'Lancer';
  const geste =
    telephone || simulation ? (
      <Action
        ref={bouton}
        ton="fort"
        disabled={Boolean(blocage) || enCours || restants === 0}
        enCours={enCours && !telephone}
        libelleEnCours={reprise ? 'Reprise…' : 'Lancement…'}
        aria-expanded={telephone ? ouverte : undefined}
        aria-describedby={blocage ? `blocage-${c.id}` : undefined}
        onClick={() => (telephone ? confirmation.ouvrir(bouton.current) : lancer())}
      >
        {libelle}
      </Action>
    ) : null;

  const reglages = ligne.joignable ? ligne.reglages : null;
  const consequences = telephone ? (
    <>
      <p>
        {restants > 1 ? `Jusqu’à ${restants} numéros vont sonner l’un après l’autre` : 'Un numéro va sonner'} ({c.entreprise} · {c.version}).
        {reglages ? (
          <>
            {' '}
            Plafond : {pluriel(reglages.appelsParHeure, 'appel', 'appels')} par heure, {reglages.appelsParJour} par 24 heures ;{' '}
            {pluriel(telephoneRecents.dernieres24h, 'appel téléphone', 'appels téléphone')} ces dernières 24 heures, d’après la base.
          </>
        ) : null}
      </p>
      {reglages ? <p className="mt-1">{phraseEstimation(restants, reglages, telephoneRecents.dernieres24h)}</p> : null}
    </>
  ) : null;

  return (
    <Cadre
      etiquette={reprise ? 'Campagne suspendue' : 'Campagne prête'}
      titre="Ligne libre"
      contexte={identiteCampagne(c)}
      phrase={
        reprise
          ? `Campagne suspendue · ${c.comptes.traites} traités sur ${c.comptes.total}`
          : `Campagne prête : ${pluriel(c.comptes.total, 'prospect', 'prospects')}`
      }
      {...(reprise
        ? raison
          ? { detail: raison, tonDetail: 'alerte' as const }
          : { detail: 'Aucun appel ne part avant la reprise.' }
        : c.ligne === 'navigateur'
          ? { detail: 'Ligne navigateur : l’appel se passe dans la page de la régie.' }
          : {})}
      actions={
        <>
          {geste}
          <LienAction ton={geste ? 'normal' : 'fort'} href={`/campagnes/${c.id}`}>
            Ouvrir la régie
          </LienAction>
        </>
      }
      sousActions={
        blocage || erreur || (telephone && ouverte) ? (
          <>
            {blocage ? (
              <p id={`blocage-${c.id}`} className="text-sm text-encre-2 sm:text-right">
                <PointCreux className="mr-2" />
                {reprise ? 'Reprise' : 'Lancement'} impossible : {blocage.charAt(0).toLocaleLowerCase('fr-FR') + blocage.slice(1)}
              </p>
            ) : null}
            {telephone ? (
              <Confirmation
                ouverte={ouverte}
                question={reprise ? 'Reprendre la campagne ?' : 'Lancer la campagne sur le téléphone passerelle ?'}
                libelleConfirmer={
                  reprise ? `Reprendre (${pluriel(restants, 'restant', 'restants')})` : `Lancer ${pluriel(restants, 'appel', 'appels')}`
                }
                enCours={enCours}
                libelleEnCours={reprise ? 'Reprise…' : 'Lancement…'}
                erreur={erreur}
                onConfirmer={lancer}
                onAnnuler={fermer}
              >
                {consequences}
              </Confirmation>
            ) : null}
            {erreur && !ouverte ? (
              <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
                {erreur}
              </p>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

function phraseEstimation(appels: number, reglages: { appelsParHeure: number; appelsParJour: number; pauseEntreAppelsS: number }, passes24h: number): string {
  // Le rythme seul (sans plafond du jour), puis l'arrêt par le plafond du jour, dit à la manière d'une campagne.
  const rythme = estimation({ appels, reglages: { ...reglages, appelsParJour: Number.MAX_SAFE_INTEGER } }).phrase;
  const { arretApres } = estimation({ appels, reglages, passes24h });
  if (arretApres === null) return rythme;
  if (arretApres === 0) return `${rythme} Le plafond journalier est déjà atteint : la campagne se mettra en pause tout de suite.`;
  return `${rythme} La campagne se mettra en pause après ${pluriel(arretApres, 'appel', 'appels')} (plafond journalier).`;
}

/* ------------------------------------------------------------------ ligne libre */

function Libre({
  dernier,
  premiereUtilisation,
  entrepriseSlug,
}: {
  dernier: AppelDuJour | null;
  premiereUtilisation: boolean;
  entrepriseSlug: string | null;
}) {
  const nomAssistante = useNomAssistante();
  if (premiereUtilisation) {
    return (
      <Cadre
        etiquette="Ligne"
        titre="Ligne libre"
        phrase={`Aucune entreprise pour l’instant : ${nomAssistante} a besoin d’une fiche, d’un script et de prospects pour appeler.`}
        actions={
          <LienAction ton="fort" href="/entreprises">
            Crée la première entreprise
          </LienAction>
        }
      />
    );
  }
  return (
    <Cadre
      etiquette="Ligne"
      titre="Ligne libre"
      phrase={
        dernier ? (
          <span className="text-encre-2">
            Dernier appel à <span className="font-mono">{heure(dernier.debutLe)}</span> :{' '}
            <Link href={lienAppel(dernier.id)} className="text-encre decoration-souligne underline-offset-4 hover:underline">
              {dernier.prospect}
            </Link>
            , {etatAppel(dernier, { libellePerso: dernier.libellePerso }).libelle}
          </span>
        ) : (
          <span className="text-encre-2">Aucun appel aujourd’hui</span>
        )
      }
      actions={
        <LienAction ton="fort" href={entrepriseSlug ? `/entreprises/${entrepriseSlug}/campagnes` : '/entreprises'}>
          Préparer une campagne
        </LienAction>
      }
    />
  );
}
