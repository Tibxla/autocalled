'use client';

import type { TourDeParole } from '@autocalled/domain';
import { useEffect, useRef, useState } from 'react';

function horodatage(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const normaliser = (t: string) =>
  t.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();

export interface ObjectionBilan {
  libelle: string;
  levee: boolean;
  tempsBloquant: string | null;
  citation: string;
  repertoriee: boolean;
}

const TEMPS: Record<string, string> = { creuser: 'creuser', reformuler: 'reformuler', argumenter: 'argumenter', controler: 'contrôler' };

/**
 * Transcription synchronisée avec l'enregistrement : cliquer une réplique déplace la lecture, la
 * réplique entendue est mise en avant. Chaque objection du bilan renvoie à la phrase qui la prouve.
 */
export function LecteurAppel({
  appelId,
  audio,
  transcription,
  objections,
}: {
  appelId: string;
  audio: boolean;
  transcription: TourDeParole[];
  objections: ObjectionBilan[];
}) {
  const lecteur = useRef<HTMLAudioElement>(null);
  const [instant, setInstant] = useState(0);
  const [surlignee, setSurlignee] = useState<number | null>(null);
  const repliques = useRef<(HTMLLIElement | null)[]>([]);

  const courante = audio ? transcription.findLastIndex((t) => t.secondes <= instant + 0.05) : -1;

  const aller = (index: number) => {
    const tour = transcription[index];
    if (!tour) return;
    setSurlignee(index);
    repliques.current[index]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (audio && lecteur.current) {
      lecteur.current.currentTime = tour.secondes;
      void lecteur.current.play();
    }
  };

  const allerALaCitation = (citation: string) => {
    const cible = normaliser(citation);
    const index = transcription.findIndex((t) => t.role === 'prospect' && normaliser(t.texte).includes(cible));
    if (index >= 0) aller(index);
  };

  useEffect(() => {
    if (surlignee === null) return;
    const minuterie = setTimeout(() => setSurlignee(null), 2400);
    return () => clearTimeout(minuterie);
  }, [surlignee]);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="grid content-start gap-5">
        {audio ? (
          <audio
            ref={lecteur}
            src={`/appels/${appelId}/audio`}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setInstant(e.currentTarget.currentTime)}
            className="w-full"
          />
        ) : null}
        <ol className="grid">
          {transcription.map((t, i) => (
            <li
              key={i}
              ref={(el) => {
                repliques.current[i] = el;
              }}
            >
              <button
                type="button"
                onClick={() => aller(i)}
                className={`grid w-full gap-x-4 rounded-md px-3 py-2.5 text-left transition-colors duration-200 hover:bg-survol sm:grid-cols-[3.5rem_4.5rem_1fr] ${
                  i === courante || i === surlignee ? 'bg-survol' : ''
                }`}
              >
                <span className="font-mono text-sm text-encre-3">{audio ? horodatage(t.secondes) : `${i + 1}`}</span>
                <span className={`text-sm ${t.role === 'agent' ? 'text-antenne' : 'text-encre-3'}`}>{t.role === 'agent' ? 'Mina' : 'Prospect'}</span>
                <span className="max-w-[68ch]">{t.texte}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid content-start gap-3">
        <h2 className="border-b border-filet pb-3 text-base font-semibold">Objections</h2>
        {objections.length === 0 ? (
          <p className="text-sm text-encre-3">Aucune objection dans cet appel.</p>
        ) : (
          <ul className="grid gap-4">
            {objections.map((o, i) => (
              <li key={i} className="grid gap-1.5">
                <div className="grid gap-1">
                  <span className="font-medium">{o.libelle}</span>
                  <span className={`inline-flex items-center gap-2 text-sm ${o.levee ? 'text-encre' : 'text-encre-3'}`}>
                    <span aria-hidden="true" className={`size-2 rounded-full ${o.levee ? 'bg-encre' : 'shadow-[inset_0_0_0_1px_var(--encre-3)]'}`} />
                    {o.levee ? 'Levée' : o.tempsBloquant ? `Bloquée à « ${TEMPS[o.tempsBloquant] ?? o.tempsBloquant} »` : 'Non levée'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => allerALaCitation(o.citation)}
                  className="justify-self-start text-left text-sm text-encre-2 underline decoration-filet-fort underline-offset-4 transition-colors duration-150 hover:text-encre hover:decoration-encre-3"
                >
                  « {o.citation} »
                </button>
                {!o.repertoriee ? <span className="text-xs text-encre-3">Objection nouvelle, absente de la fiche.</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
