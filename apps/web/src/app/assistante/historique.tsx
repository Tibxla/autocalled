'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { heure, jourCourt } from '@/components/format-appel';
import { Action, Message } from '@/components/ui';
import { RESTAURATION } from '@/lib/questions-assistante';
import { ORIGINE_VERSION } from '@/lib/vue-assistante';
import { detailVersionAction, restaurerAction } from './actions';
import { BlocDifference } from './blocs';

/**
 * Les configurations consignées, comme historique_assistante, et le retour arrière, comme restaurer_assistante :
 * « Restaurer » lit d'abord ce qui sépare la version des fichiers, puis demande confirmation. La version restaurée
 * ne sert aux appels qu'après une poussée : la page le rappelle.
 */

export interface LigneVersion {
  versionId: string;
  consigneLe: string;
  origine: string;
  appels: number;
  estLeVerrou: boolean;
}

type Detail = Extract<Awaited<ReturnType<typeof detailVersionAction>>, { ok: true }>;

export function Historique({ versions }: { versions: LigneVersion[] }) {
  const router = useRouter();
  const confirmation = useConfirmation();
  const declencheurs = useRef(new Map<string, HTMLButtonElement>());
  const [detail, setDetail] = useState<Detail | null>(null);
  const [lue, setLue] = useState<string | null>(null);
  const [retour, setRetour] = useState<{ versionId: string; ton: 'neutre' | 'alerte'; texte: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, lire] = useTransition();
  const [ecriture, ecrire] = useTransition();

  const ouvrir = (versionId: string) => {
    setRetour(null);
    setLue(versionId);
    lire(async () => {
      const r = await detailVersionAction(versionId);
      if (!r.ok) {
        setRetour({ versionId, ton: 'alerte', texte: r.raison });
        return;
      }
      setDetail(r);
      setErreur(null);
      confirmation.ouvrir(declencheurs.current.get(versionId) ?? null);
    });
  };

  const confirmer = () =>
    ecrire(async () => {
      if (!detail) return;
      const r = await restaurerAction(detail.versionId);
      if (!r.ok) {
        setErreur(r.raison);
        return;
      }
      const versionId = detail.versionId;
      confirmation.fermer();
      setDetail(null);
      setRetour({ versionId, ton: 'neutre', texte: `${r.rappel} La poussée se fait plus haut, section Poussée.` });
      router.refresh();
    });

  const fermer = () => {
    confirmation.fermer();
    setDetail(null);
  };

  return (
    <ol className="border-t border-filet">
      {versions.map((v) => {
        const date = new Date(v.consigneLe);
        const ouverte = confirmation.ouverte && detail?.versionId === v.versionId;
        return (
          <li key={v.versionId} className="grid min-w-0 gap-2 border-b border-filet py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="grid min-w-0 gap-0.5">
                <p className="font-mono text-sm break-all text-encre">{v.versionId}</p>
                <p className="text-sm text-encre-3">
                  {ORIGINE_VERSION[v.origine] ?? v.origine}, le{' '}
                  <time dateTime={v.consigneLe} className="font-mono">
                    {jourCourt(date)} {heure(date)}
                  </time>{' '}
                  · <span className="font-mono">{v.appels}</span> appel{v.appels > 1 ? 's' : ''}
                  {v.estLeVerrou ? <span className="text-encre-2"> · version des fichiers de agent/</span> : null}
                </p>
              </div>
              {v.estLeVerrou ? null : (
                <Action
                  ref={(b) => {
                    if (b) declencheurs.current.set(v.versionId, b);
                    else declencheurs.current.delete(v.versionId);
                  }}
                  ton="normal"
                  className="-mx-1.5 pointer-coarse:mx-0"
                  disabled={lecture || ecriture || confirmation.ouverte}
                  enCours={lecture && lue === v.versionId}
                  libelleEnCours="Lecture…"
                  onClick={() => ouvrir(v.versionId)}
                >
                  Restaurer
                </Action>
              )}
            </div>
            {retour?.versionId === v.versionId ? <Message ton={retour.ton}>{retour.texte}</Message> : null}
            <Confirmation
              ouverte={ouverte}
              question={RESTAURATION.question}
              libelleConfirmer="Restaurer"
              enCours={ecriture}
              libelleEnCours="Restauration…"
              erreur={erreur}
              onAnnuler={fermer}
              onConfirmer={confirmer}
            >
              {detail ? (
                <div className="grid gap-2">
                  <p>{RESTAURATION.explication}</p>
                  {detail.identique ? (
                    <p className="text-encre-3">{RESTAURATION.identique}</p>
                  ) : (
                    <>
                      <p className="text-encre-3">{RESTAURATION.difference}</p>
                      <BlocDifference texte={detail.difference} libelle="Différence avec les fichiers de agent/" />
                    </>
                  )}
                </div>
              ) : null}
            </Confirmation>
          </li>
        );
      })}
    </ol>
  );
}
