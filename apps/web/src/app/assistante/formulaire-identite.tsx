'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action, Champ, Message, Saisie } from '@/components/ui';
import { enregistrerIdentiteAction, preparerIdentiteAction } from './actions';

/**
 * Le nom et le premier message de l'assistante, comme modifier_assistante : l'envoi demande d'abord au serveur la
 * question à poser (ancien et nouveau texte, campagne en cours), puis écrit après la confirmation
 * en ligne. `connu` (le `modifieLe` affiché) refuse d'écrire par-dessus une modification faite ailleurs entre-temps.
 */

type Retour = { ton: 'neutre' | 'alerte'; texte: string } | null;

export function FormulaireIdentite({
  nom,
  premierMessage,
  connu,
}: {
  nom: string;
  premierMessage: string;
  connu: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const confirmation = useConfirmation();
  const [valeurs, setValeurs] = useState({ nom, premierMessage });
  const [lignes, setLignes] = useState<string[]>([]);
  const [retour, setRetour] = useState<Retour>(null);
  const [erreurConfirmation, setErreurConfirmation] = useState<string | null>(null);
  const [perime, setPerime] = useState(false);
  const [preparation, preparer] = useTransition();
  const [ecriture, ecrire] = useTransition();
  const [rechargement, recharger] = useTransition();

  // Les valeurs enregistrées changent (ici, ou par Claude Code) : la saisie suit tant qu'elle est intacte.
  const [base, setBase] = useState({ nom, premierMessage, connu });
  if (base.nom !== nom || base.premierMessage !== premierMessage || base.connu !== connu) {
    setBase({ nom, premierMessage, connu });
    if (valeurs.nom === base.nom && valeurs.premierMessage === base.premierMessage) setValeurs({ nom, premierMessage });
  }

  const saisie = {
    ...(valeurs.nom.trim() !== nom ? { nom: valeurs.nom } : {}),
    ...(valeurs.premierMessage.trim() !== premierMessage ? { premierMessage: valeurs.premierMessage } : {}),
  };
  const change = Object.keys(saisie).length > 0;
  const occupe = preparation || ecriture;

  useRaccourci({
    touche: 'Enter',
    ctrl: true,
    dansChamp: true,
    libelle: 'Enregistrer le nom et le premier message',
    actif: change && !occupe && !confirmation.ouverte,
    action: () => {
      if (!formulaire.current?.contains(document.activeElement)) return false;
      formulaire.current.requestSubmit();
    },
  });

  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!change || occupe) return;
    setRetour(null);
    setPerime(false);
    preparer(async () => {
      const r = await preparerIdentiteAction({ ...saisie, connu });
      if (!r.ok) {
        setRetour({ ton: 'alerte', texte: r.raison });
        setPerime(r.raison.includes('recharge la page'));
        return;
      }
      setLignes(r.lignes);
      setErreurConfirmation(null);
      confirmation.ouvrir(bouton.current);
    });
  };

  const confirmer = () =>
    ecrire(async () => {
      const r = await enregistrerIdentiteAction({ ...saisie, connu });
      if (!r.ok) {
        setErreurConfirmation(r.raison);
        setPerime(r.raison.includes('recharge la page'));
        return;
      }
      confirmation.fermer();
      setRetour({ ton: 'neutre', texte: `Enregistré. ${r.rappel}` });
      router.refresh();
    });

  return (
    <form ref={formulaire} onSubmit={envoyer} noValidate className="grid gap-5" aria-busy={occupe}>
      <div className="grid gap-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6">
        <Champ libelle="Nom" htmlFor={`${id}-nom`} aide="Un prénom d’un ou deux mots, 2 à 24 lettres.">
          <Saisie
            id={`${id}-nom`}
            name="nom"
            autoComplete="off"
            maxLength={24}
            value={valeurs.nom}
            disabled={occupe}
            onChange={(e) => {
              const v = e.target.value;
              setValeurs((s) => ({ ...s, nom: v }));
              setRetour(null);
            }}
          />
        </Champ>
        <Champ
          libelle="Premier message"
          htmlFor={`${id}-message`}
          aide="Dit quand le prospect se tait au décroché. Une ligne, 160 caractères au plus ; ses {{variables}} sont celles du prompt, par exemple {{prospect_nom}}."
        >
          <Saisie
            id={`${id}-message`}
            name="premierMessage"
            autoComplete="off"
            maxLength={160}
            value={valeurs.premierMessage}
            disabled={occupe}
            onChange={(e) => {
              const v = e.target.value;
              setValeurs((s) => ({ ...s, premierMessage: v }));
              setRetour(null);
            }}
          />
        </Champ>
      </div>

      {retour ? (
        <Message
          ton={retour.ton}
          action={
            perime ? (
              <Action
                ton="normal"
                enCours={rechargement}
                libelleEnCours="Rechargement…"
                onClick={() =>
                  recharger(() => {
                    router.refresh();
                    setValeurs({ nom, premierMessage });
                    setRetour(null);
                    setPerime(false);
                  })
                }
              >
                Recharger
              </Action>
            ) : undefined
          }
        >
          {retour.texte}
        </Message>
      ) : null}

      <div className="grid gap-3">
        <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pointer-coarse:mx-0">
          <Action
            ref={bouton}
            type="submit"
            ton="fort"
            touche="Ctrl Entrée"
            disabled={!change || occupe || confirmation.ouverte}
            enCours={preparation}
            libelleEnCours="Vérification…"
          >
            Enregistrer
          </Action>
          {change && !occupe ? (
            <Action
              ton="discret"
              onClick={() => {
                setValeurs({ nom, premierMessage });
                setRetour(null);
                confirmation.fermer();
              }}
            >
              Revenir aux valeurs enregistrées
            </Action>
          ) : null}
        </div>
        <Confirmation
          ouverte={confirmation.ouverte}
          question="Enregistrer pour le prochain appel ?"
          libelleConfirmer="Enregistrer"
          enCours={ecriture}
          libelleEnCours="Enregistrement…"
          erreur={erreurConfirmation}
          onAnnuler={confirmation.fermer}
          onConfirmer={confirmer}
        >
          {lignes.map((l) => (
            <p key={l} className="break-words">
              {l}
            </p>
          ))}
        </Confirmation>
      </div>
    </form>
  );
}
