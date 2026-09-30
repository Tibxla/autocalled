'use client';

import { useState, useTransition } from 'react';
import { chrono } from '@/components/format-appel';
import { useHorloge } from '@/components/horloge';
import { Action } from '@/components/ui';
import type { ResultatAction } from '@/lib/formulaire';
import { recreerEvenement, relireAgenda } from './actions';

/**
 * « Relire l'agenda maintenant » : la lecture par le connecteur prend une vingtaine de secondes. Pendant ce
 * temps le bouton reste désactivé (plus de double lecture) et un chrono montre que ça avance ; à la fin, ce
 * que la lecture a donné, ou pourquoi elle a échoué.
 */
export function BoutonRelire({ relire = relireAgenda }: { relire?: () => Promise<ResultatAction<{ plagesOccupees: number }>> }) {
  const [enCours, demarrer] = useTransition();
  const [debut, setDebut] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);
  const maintenant = useHorloge(enCours);
  const ecoule = enCours && debut && maintenant ? chrono(maintenant - debut) : '';

  return (
    <div className="grid gap-1">
      {/* L'action principale de la zone Agenda : ton fort, en relief au doigt. */}
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-3 pointer-coarse:mx-0">
        <Action
          ton="fort"
          disabled={enCours}
          enCours={enCours}
          libelleEnCours="Lecture de l’agenda…"
          onClick={() => {
            setErreur(null);
            setFait(null);
            setDebut(Date.now());
            demarrer(async () => {
              try {
                const resultat = await relire();
                if (!resultat.ok) return setErreur(resultat.raison);
                const n = resultat.plagesOccupees;
                setFait(`Agenda relu : ${n === 0 ? 'aucune plage occupée' : `${n} plage${n > 1 ? 's' : ''} occupée${n > 1 ? 's' : ''}`}.`);
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
      <p role="status" className="text-sm text-encre-2">
        {fait}
      </p>
    </div>
  );
}

export function BoutonRecreer({
  rendezVousId,
  recreer = recreerEvenement,
}: {
  rendezVousId: string;
  recreer?: (id: string) => Promise<ResultatAction>;
}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  if (fait) {
    return (
      <span role="status" className="text-sm text-encre-2">
        Événement inscrit dans l’agenda.
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Action
        ton="normal"
        className="-mx-1.5"
        disabled={enCours}
        enCours={enCours}
        libelleEnCours="Inscription…"
        onClick={() =>
          demarrer(async () => {
            setErreur(null);
            try {
              const resultat = await recreer(rendezVousId);
              if (!resultat.ok) return setErreur(resultat.raison);
              setFait(true);
            } catch {
              setErreur('Nouvelle tentative impossible pour l’instant.');
            }
          })
        }
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
