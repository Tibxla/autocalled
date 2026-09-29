'use client';

import type { TourDeParole } from '@autocalled/domain';
import { useEffect, useId, useRef, useState } from 'react';
import { Action } from '@/components/action';
import { useRaccourcis } from '@/components/clavier';

function horodatage(s: number) {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const normaliser = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();

export interface ObjectionBilan {
  libelle: string;
  levee: boolean;
  tempsBloquant: string | null;
  citation: string;
  repertoriee: boolean;
}

const TEMPS: Record<string, string> = { creuser: 'creuser', reformuler: 'reformuler', argumenter: 'argumenter', controler: 'contrôler' };

/** Pas des flèches ← et → dans l'enregistrement, en secondes. */
const SAUT = 5;
/** Après un défilement à la main, la transcription ne suit plus la lecture pendant ce délai. */
const REPIT_DEFILEMENT_MS = 5000;

/** Découpe un texte autour des occurrences d'un terme (sans casse) pour les surligner. */
function morceaux(texte: string, terme: string): { texte: string; trouve: boolean }[] {
  if (!terme) return [{ texte, trouve: false }];
  const bas = texte.toLocaleLowerCase('fr-FR');
  const cherche = terme.toLocaleLowerCase('fr-FR');
  const resultat: { texte: string; trouve: boolean }[] = [];
  let depuis = 0;
  for (let i = bas.indexOf(cherche); i >= 0; i = bas.indexOf(cherche, i + cherche.length)) {
    if (i > depuis) resultat.push({ texte: texte.slice(depuis, i), trouve: false });
    resultat.push({ texte: texte.slice(i, i + cherche.length), trouve: true });
    depuis = i + cherche.length;
  }
  if (depuis < texte.length) resultat.push({ texte: texte.slice(depuis), trouve: false });
  return resultat;
}

/**
 * Bilan et transcription d'un appel terminé, dans un seul composant : une citation d'objection déplace la
 * lecture et surligne la phrase qui la prouve. Barre de lecture maison (les contrôles natifs restaient clairs
 * sur le graphite), une seule réplique tabulable (flèches pour passer de l'une à l'autre), défilement du seul
 * conteneur de la transcription, qui suit la lecture sauf si l'opérateur a défilé à la main.
 *
 * Clavier (appel terminé, rien d'autre ne réclame ces touches) : Espace lecture et pause, ← et → cinq secondes,
 * ↑ et ↓ réplique précédente et suivante.
 */
export function LecteurAppel({
  appelId,
  audio,
  transcription,
  objections,
  nomProspect = 'Prospect',
  recherche = '',
  bilan,
  pied,
  raccourcis = true,
}: {
  appelId: string;
  audio: boolean;
  transcription: TourDeParole[];
  objections: ObjectionBilan[];
  /** Prénom affiché devant les répliques du prospect. */
  nomProspect?: string;
  /** Terme cherché depuis la liste : occurrences surlignées, lecture placée sur la première. */
  recherche?: string;
  /** Haut de la colonne du bilan (résumé, rendu serveur) ; sans bilan ni objection, une seule colonne. */
  bilan?: React.ReactNode;
  /** Bas de la colonne du bilan (points, note, réanalyse). */
  pied?: React.ReactNode;
  raccourcis?: boolean;
}) {
  const lecteur = useRef<HTMLAudioElement>(null);
  const conteneur = useRef<HTMLDivElement>(null);
  const repliques = useRef<(HTMLButtonElement | null)[]>([]);
  const defilementAuto = useRef(0);
  const defilementManuel = useRef(0);
  const positionneeSurRecherche = useRef(false);
  const idTitre = useId();
  const idObjections = useId();

  const premiereOccurrence = recherche
    ? transcription.findIndex((t) => t.texte.toLocaleLowerCase('fr-FR').includes(recherche.toLocaleLowerCase('fr-FR')))
    : -1;

  const [audioDispo, setAudioDispo] = useState(audio);
  const [instant, setInstant] = useState(premiereOccurrence >= 0 ? (transcription[premiereOccurrence]?.secondes ?? 0) : 0);
  const [dureeAudio, setDureeAudio] = useState(0);
  const [enLecture, setEnLecture] = useState(false);
  const [surlignee, setSurlignee] = useState<number | null>(null);
  const [choisie, setChoisie] = useState(premiereOccurrence);
  const [tabulable, setTabulable] = useState(Math.max(0, premiereOccurrence));

  const dureeTotale = dureeAudio || (transcription.at(-1)?.secondes ?? 0);
  const courante = audioDispo ? transcription.findLastIndex((t) => t.secondes <= instant + 0.05) : choisie;

  const defiler = (index: number, force: boolean) => {
    const c = conteneur.current;
    const li = repliques.current[index];
    if (!c || !li || c.scrollHeight <= c.clientHeight + 1) return;
    if (!force && Date.now() - defilementManuel.current < REPIT_DEFILEMENT_MS) return;
    const cible = li.offsetTop - c.clientHeight / 3;
    defilementAuto.current = Date.now();
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.scrollTo({ top: Math.max(0, cible), behavior: reduit ? 'auto' : 'smooth' });
  };

  // La transcription suit la lecture.
  useEffect(() => {
    if (courante >= 0) defiler(courante, false);
  }, [courante]);

  // Arrivée avec ?q= : la première occurrence est déjà la réplique choisie ; on l'amène à l'écran.
  useEffect(() => {
    if (premiereOccurrence >= 0) defiler(premiereOccurrence, true);
    // Une seule fois, à l'arrivée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Un échec de chargement ou des métadonnées arrivés avant l'hydratation ne passent pas par les gestionnaires
  // React : on relit l'état de l'élément une fois monté.
  useEffect(() => {
    const a = lecteur.current;
    if (!a) return;
    const minuterie = setTimeout(() => {
      if (a.error || a.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) setAudioDispo(false);
      else if (a.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(a.duration)) {
        setDureeAudio(a.duration);
        if (!positionneeSurRecherche.current && premiereOccurrence >= 0) {
          positionneeSurRecherche.current = true;
          a.currentTime = transcription[premiereOccurrence]?.secondes ?? 0;
        }
      }
    }, 0);
    return () => clearTimeout(minuterie);
    // Une seule fois, au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (surlignee === null) return;
    const minuterie = setTimeout(() => setSurlignee(null), 2400);
    return () => clearTimeout(minuterie);
  }, [surlignee]);

  const placer = (secondes: number) => {
    const a = lecteur.current;
    const borne = Math.max(0, dureeTotale ? Math.min(dureeTotale, secondes) : secondes);
    if (a && audioDispo) a.currentTime = borne;
    setInstant(borne);
  };

  const basculer = () => {
    const a = lecteur.current;
    if (!a || !audioDispo) return;
    if (a.paused) void a.play().catch(() => setAudioDispo(false));
    else a.pause();
  };

  /** Aller à une réplique : lecture placée dessus (et lancée), surlignage bref, focus possible. */
  const aller = (index: number, { jouer = true, focus = false }: { jouer?: boolean; focus?: boolean } = {}) => {
    const tour = transcription[index];
    if (!tour) return;
    setChoisie(index);
    setTabulable(index);
    setSurlignee(index);
    defiler(index, true);
    if (focus) repliques.current[index]?.focus({ preventScroll: true });
    const a = lecteur.current;
    if (a && audioDispo) {
      a.currentTime = tour.secondes;
      setInstant(tour.secondes);
      if (jouer) void a.play().catch(() => setAudioDispo(false));
    }
  };

  const indexCitation = (citation: string) => {
    const cible = normaliser(citation);
    if (!cible) return -1;
    return transcription.findIndex((t) => t.role === 'prospect' && normaliser(t.texte).includes(cible));
  };

  const pret = raccourcis && audioDispo;
  useRaccourcis([
    { touche: 'ArrowLeft', libelle: `Reculer de ${SAUT} secondes`, repetition: true, actif: pret, action: () => placer(instant - SAUT) },
    { touche: 'ArrowRight', libelle: `Avancer de ${SAUT} secondes`, repetition: true, actif: pret, action: () => placer(instant + SAUT) },
    {
      touche: 'ArrowUp',
      libelle: 'Réplique précédente',
      repetition: true,
      actif: pret,
      action: () => aller(Math.max(0, courante - 1), { jouer: !lecteur.current?.paused }),
    },
    {
      touche: 'ArrowDown',
      libelle: 'Réplique suivante',
      repetition: true,
      actif: pret,
      action: () => aller(Math.min(transcription.length - 1, courante + 1), { jouer: !lecteur.current?.paused }),
    },
  ]);

  const surToucheReplique = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const suivant =
      e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? transcription.length - 1 : null;
    if (suivant !== null) {
      e.preventDefault();
      const borne = Math.min(transcription.length - 1, Math.max(0, suivant));
      aller(borne, { jouer: Boolean(lecteur.current && !lecteur.current.paused), focus: true });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      aller(i);
    }
  };

  const colonneBilan = Boolean(bilan) || Boolean(pied) || objections.length > 0;
  const progression = dureeTotale > 0 ? Math.min(100, (instant / dureeTotale) * 100) : 0;

  return (
    <div className={`grid gap-10 ${colonneBilan ? 'lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12' : ''}`}>
      {colonneBilan ? (
        <aside
          aria-label="Bilan"
          className="grid min-w-0 content-start gap-7 lg:sticky lg:top-[calc(var(--hauteur-barre)+16px)] lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-var(--hauteur-barre)-32px)] lg:self-start lg:overflow-y-auto lg:pr-1"
        >
          {bilan}
          <section aria-labelledby={idObjections} className="grid gap-3">
            <h3 id={idObjections} className="text-md font-semibold">
              Objections
              {objections.length ? <span className="ml-2 font-mono font-normal text-encre-3">{objections.length}</span> : null}
            </h3>
            {objections.length === 0 ? (
              <p className="text-sm text-encre-3">Aucune objection dans cet appel.</p>
            ) : (
              <ul className="grid gap-4">
                {objections.map((o, i) => {
                  const index = indexCitation(o.citation);
                  const tour = index >= 0 ? transcription[index] : undefined;
                  return (
                    <li key={i} className="grid gap-1">
                      <p className="font-medium text-encre">{o.libelle}</p>
                      <p className={`text-sm ${o.levee ? 'text-encre-2' : 'text-encre-3'}`}>
                        {o.levee ? 'Levée' : o.tempsBloquant ? `Bloquée à « ${TEMPS[o.tempsBloquant] ?? o.tempsBloquant} »` : 'Non levée'}
                      </p>
                      {tour ? (
                        <button
                          type="button"
                          onClick={() => aller(index)}
                          className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2.5 justify-self-start rounded-[4px] py-0.5 text-left text-sm text-encre-2 transition-colors duration-150 hover:text-encre"
                        >
                          <span className="font-mono text-xs text-encre-3">{horodatage(tour.secondes)}</span>
                          <span className="decoration-souligne underline-offset-4 hover:underline">« {o.citation} »</span>
                        </button>
                      ) : (
                        <p className="grid gap-0.5 text-sm">
                          <span className="text-encre-2">« {o.citation} »</span>
                          <span className="text-alerte">Phrase introuvable dans la transcription</span>
                        </p>
                      )}
                      {!o.repertoriee ? <p className="text-sm text-encre-3">Objection nouvelle, absente de la fiche.</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {pied}
        </aside>
      ) : null}

      <section aria-labelledby={idTitre} className="grid min-w-0 content-start gap-3 lg:col-start-1 lg:row-start-1">
        <div className="flex items-baseline justify-between gap-4 border-b border-filet pb-2.5">
          <h2 id={idTitre} className="text-base font-semibold">
            Conversation
            <span className="ml-2.5 font-mono text-md font-normal text-encre-3">{transcription.length}</span>
          </h2>
          {recherche && premiereOccurrence < 0 ? (
            <span className="text-sm text-encre-3">« {recherche} » n’apparaît pas dans la transcription.</span>
          ) : null}
        </div>

        {audio ? (
          <audio
            ref={lecteur}
            src={`/appels/${appelId}/audio`}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const a = e.currentTarget;
              if (Number.isFinite(a.duration)) setDureeAudio(a.duration);
              if (!positionneeSurRecherche.current && premiereOccurrence >= 0) {
                positionneeSurRecherche.current = true;
                a.currentTime = transcription[premiereOccurrence]?.secondes ?? 0;
              }
            }}
            onTimeUpdate={(e) => setInstant(e.currentTarget.currentTime)}
            onPlay={() => setEnLecture(true)}
            onPause={() => setEnLecture(false)}
            onEnded={() => setEnLecture(false)}
            onError={() => setAudioDispo(false)}
            className="hidden"
          />
        ) : null}

        {audioDispo ? (
          <div className="-mx-1.5 flex items-center gap-4 pb-1">
            <Action
              ton="fort"
              touche="Espace"
              raccourci={raccourcis ? ' ' : undefined}
              libelleRaccourci="Lecture ou pause"
              onClick={basculer}
              className="w-[7.75rem] shrink-0"
            >
              {enLecture ? 'Pause' : 'Lecture'}
            </Action>
            <span className="shrink-0 font-mono text-sm text-encre-3 tabular-nums">
              <span className="text-encre-2">{horodatage(instant)}</span> / {horodatage(dureeTotale)}
            </span>
            <div className="relative h-6 min-w-0 flex-1 rounded-[3px] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus">
              <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-filet-fort" />
              <span aria-hidden="true" className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-encre" style={{ width: `${progression}%` }} />
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 bg-encre"
                style={{ left: `calc(${progression}% - 1.5px)` }}
              />
              <input
                type="range"
                min={0}
                max={Math.max(1, dureeTotale)}
                step={0.1}
                value={Math.min(instant, Math.max(1, dureeTotale))}
                onChange={(e) => placer(Number(e.target.value))}
                aria-label="Position dans l’enregistrement"
                aria-valuetext={`${horodatage(instant)} sur ${horodatage(dureeTotale)}`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none"
              />
            </div>
          </div>
        ) : audio ? (
          <p className="text-sm text-encre-3">Enregistrement indisponible : la transcription reste horodatée.</p>
        ) : (
          <p className="text-sm text-encre-3">Pas d’enregistrement pour cet appel.</p>
        )}

        <div
          ref={conteneur}
          onScroll={() => {
            if (Date.now() - defilementAuto.current > 800) defilementManuel.current = Date.now();
          }}
          className="relative lg:max-h-[calc(100dvh-var(--hauteur-barre)-10rem)] lg:overflow-y-auto"
        >
          <ol aria-label="Transcription" className="grid gap-0.5">
            {transcription.map((t, i) => {
              const mina = t.role === 'agent';
              const actuelle = i === courante;
              return (
                <li key={i} aria-current={actuelle ? 'true' : undefined}>
                  <button
                    type="button"
                    ref={(el) => {
                      repliques.current[i] = el;
                    }}
                    tabIndex={i === tabulable ? 0 : -1}
                    onClick={() => aller(i)}
                    onKeyDown={(e) => surToucheReplique(e, i)}
                    onFocus={() => setTabulable(i)}
                    className={`focus-interne grid w-full cursor-pointer grid-cols-[3rem_minmax(0,1fr)] gap-x-3 rounded-[4px] px-2 py-2 text-left transition-colors duration-150 hover:bg-survol ${
                      actuelle ? 'bg-survol' : ''
                    } ${i === surlignee ? 'bg-survol shadow-[inset_0_0_0_1px_var(--filet-fort)]' : ''}`}
                  >
                    <span className="pt-0.5 font-mono text-xs text-encre-3">
                      {audioDispo ? <span className="sr-only">Lire depuis </span> : null}
                      {horodatage(t.secondes)}
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className={`text-md font-semibold ${mina ? 'text-antenne' : 'text-encre'}`}>{mina ? 'Mina' : nomProspect}</span>
                      <span className="block max-w-[68ch] text-base text-encre-2">
                        {morceaux(t.texte, recherche).map((m, j) =>
                          m.trouve ? (
                            <mark key={j} className="rounded-[2px] bg-filet-2 text-encre">
                              {m.texte}
                            </mark>
                          ) : (
                            <span key={j}>{m.texte}</span>
                          ),
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
