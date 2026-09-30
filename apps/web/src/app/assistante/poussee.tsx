'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action, Message } from '@/components/ui';
import { POUSSEE, RAPATRIEMENT } from '@/lib/questions-assistante';
import { preparerPousseeAction, pousserAction, rapatrierAction } from './actions';
import { BlocDifference } from './blocs';

/**
 * Pousser vers ElevenLabs, comme pousser_assistante : le serveur lit ElevenLabs et rédige la différence, la page la
 * montre, puis une confirmation en ligne explicite ; la poussée part seulement si rien n'a bougé depuis (`attendu`).
 * Refusée pendant un appel. Rapatrier, comme rapatrier_assistante, sous confirmation aussi : il réécrit agent/.
 */

type Preparation = Extract<Awaited<ReturnType<typeof preparerPousseeAction>>, { ok: true }>;
type Retour = { ton: 'neutre' | 'alerte'; texte: string } | null;

export function Poussee() {
  const router = useRouter();
  const boutonPousser = useRef<HTMLButtonElement>(null);
  const boutonRapatrier = useRef<HTMLButtonElement>(null);
  const confirmationPoussee = useConfirmation();
  const confirmationRapatriement = useConfirmation();
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [retour, setRetour] = useState<Retour>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, lire] = useTransition();
  const [poussee, pousser] = useTransition();
  const [rapatriement, rapatrier] = useTransition();
  const occupe = lecture || poussee || rapatriement;

  const preparer = () => {
    setRetour(null);
    confirmationRapatriement.fermer();
    lire(async () => {
      const r = await preparerPousseeAction();
      if (!r.ok) {
        setPreparation(null);
        setRetour({ ton: 'alerte', texte: r.raison });
        return;
      }
      setPreparation(r);
      setErreur(null);
      confirmationPoussee.ouvrir(boutonPousser.current);
    });
  };

  const confirmerPoussee = () =>
    pousser(async () => {
      if (!preparation) return;
      const r = await pousserAction(preparation.attendu);
      if (!r.ok) {
        setErreur(r.raison);
        return;
      }
      confirmationPoussee.fermer();
      setPreparation(null);
      setRetour({ ton: 'neutre', texte: `Poussé : version ${r.versionAvant ?? '?'} → ${r.versionApres ?? '?'}. Elle sert dès le prochain appel. ${r.rappel}` });
      router.refresh();
    });

  const confirmerRapatriement = () =>
    rapatrier(async () => {
      const r = await rapatrierAction();
      if (!r.ok) {
        setErreur(r.raison);
        return;
      }
      confirmationRapatriement.fermer();
      setRetour({ ton: 'neutre', texte: `Rapatrié : agent/ porte la version ${r.versionId ?? '?'}. ${r.rappel}` });
      router.refresh();
    });

  return (
    <div className="grid gap-3">
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 pointer-coarse:mx-0">
        <Action
          ref={boutonPousser}
          ton="fort"
          disabled={occupe || confirmationPoussee.ouverte}
          enCours={lecture}
          libelleEnCours="Lecture d’ElevenLabs…"
          onClick={preparer}
        >
          Pousser vers ElevenLabs
        </Action>
        <Action
          ref={boutonRapatrier}
          ton="normal"
          disabled={occupe || confirmationRapatriement.ouverte}
          onClick={() => {
            setRetour(null);
            setErreur(null);
            confirmationPoussee.fermer();
            confirmationRapatriement.ouvrir(boutonRapatrier.current);
          }}
        >
          Rapatrier d’ElevenLabs
        </Action>
      </div>

      {retour ? <Message ton={retour.ton}>{retour.texte}</Message> : null}

      <Confirmation
        ouverte={confirmationPoussee.ouverte && preparation !== null}
        question={POUSSEE.question}
        libelleConfirmer="Pousser"
        enCours={poussee}
        libelleEnCours="Poussée…"
        erreur={erreur}
        onAnnuler={() => {
          confirmationPoussee.fermer();
          setPreparation(null);
        }}
        onConfirmer={confirmerPoussee}
      >
        {preparation ? (
          <div className="grid gap-2">
            <p>{preparation.question}</p>
            <p className="text-encre-3">{POUSSEE.difference}</p>
            <BlocDifference texte={preparation.difference} libelle="Différence de la poussée" />
          </div>
        ) : null}
      </Confirmation>

      <Confirmation
        ouverte={confirmationRapatriement.ouverte}
        question={RAPATRIEMENT.question}
        libelleConfirmer="Rapatrier"
        enCours={rapatriement}
        libelleEnCours="Rapatriement…"
        erreur={erreur}
        onAnnuler={confirmationRapatriement.fermer}
        onConfirmer={confirmerRapatriement}
      >
        {RAPATRIEMENT.explication}
      </Confirmation>
    </div>
  );
}
