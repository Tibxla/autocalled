'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { chrono } from '@/components/format-appel';
import { useHorloge } from '@/components/horloge';
import { Action } from '@/components/ui';
import { recreerEvenement, relireAgenda } from './actions';

/**
 * « Relire l'agenda maintenant » : la lecture par le connecteur prend une vingtaine de secondes. Pendant ce
 * temps le bouton reste désactivé (plus de double lecture) et un chrono montre que ça avance.
 */
export function BoutonRelire({ relire = relireAgenda }: { relire?: () => Promise<void> }) {
  const [enCours, demarrer] = useTransition();
  const [debut, setDebut] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const maintenant = useHorloge(enCours);
  const ecoule = enCours && debut && maintenant ? chrono(maintenant - debut) : '';

  return (
    <div className="grid gap-1">
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-3">
        <Action
          ton="normal"
          disabled={enCours}
          enCours={enCours}
          libelleEnCours="Lecture de l’agenda…"
          onClick={() => {
            setErreur(null);
            setDebut(Date.now());
            demarrer(async () => {
              try {
                await relire();
              } catch {
                setErreur('La lecture n’a pas pu être lancée. Réessaie dans un instant.');
              }
            });
          }}
        >
          Relire l’agenda maintenant
        </Action>
        {enCours ? (
          <span className="text-sm text-encre-3">
            <span className="font-mono">{ecoule || '00:00'}</span>, une vingtaine de secondes par le connecteur
          </span>
        ) : null}
      </div>
      {erreur ? (
        <p role="alert" className="text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

/** Délai avant de relire le statut d'un rendez-vous après une nouvelle tentative (l'inscription se fait en tâche de fond). */
const RELECTURE_MS = 5000;

export function BoutonRecreer({
  rendezVousId,
  recreer = recreerEvenement,
}: {
  rendezVousId: string;
  recreer?: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'lancee'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (etat !== 'lancee') return;
    const minuterie = setTimeout(() => {
      router.refresh();
      setEtat('repos');
    }, RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [etat, router]);

  if (etat === 'lancee') {
    return (
      <span role="status" className="text-sm text-encre-2">
        Nouvelle tentative lancée…
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Action
        ton="normal"
        className="-mx-1.5"
        disabled={etat === 'envoi'}
        enCours={etat === 'envoi'}
        libelleEnCours="Envoi…"
        onClick={async () => {
          setErreur(null);
          setEtat('envoi');
          try {
            await recreer(rendezVousId);
            setEtat('lancee');
          } catch {
            setErreur('Nouvelle tentative impossible pour l’instant.');
            setEtat('repos');
          }
        }}
      >
        Réessayer
      </Action>
      {erreur ? (
        <span role="alert" className="text-sm text-alerte">
          {erreur}
        </span>
      ) : null}
    </span>
  );
}
