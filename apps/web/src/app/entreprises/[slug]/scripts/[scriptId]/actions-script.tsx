'use client';

import { useRef, useState, useTransition } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action, Saisie } from '@/components/ui';
import { basculerArchiveScript, renommerScript } from '../../actions';

/**
 * Renommer et archiver un script, en bas de sa page, à 32 px l'un de l'autre. Renommer ouvre une rangée d'édition
 * (Entrée enregistre, Échap annule). Archiver est direct, comme pour une objection, sauf si une campagne (en cours ou
 * suspendue) ou un appel en ligne utilise l'une de ses versions : une confirmation en ligne rappelle alors qu'ils
 * continuent. Après l'archivage, le statut propose « Annuler ». Aucune touche seule n'archive. La page dit, sous le
 * titre, qu'un script est archivé.
 */
export function ActionsScript({
  entrepriseId,
  scriptId,
  nom,
  archive,
  usage,
}: {
  entrepriseId: string;
  scriptId: string;
  nom: string;
  archive: boolean;
  usage: { campagnes: number; appelsEnCours: number };
}) {
  const [edition, setEdition] = useState(false);
  const [saisie, setSaisie] = useState(nom);
  const [erreurNom, setErreurNom] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<string | null>(null);
  /** Vrai juste après un archivage : « Annuler » le défait. */
  const [annulable, setAnnulable] = useState(false);
  const [renommage, demarrerRenommage] = useTransition();
  const [archivage, demarrerArchivage] = useTransition();
  const confirmation = useConfirmation();
  const boutonRenommer = useRef<HTMLButtonElement>(null);
  const formulaire = useRef<HTMLFormElement>(null);

  const fermerEdition = () => {
    setEdition(false);
    setErreurNom(null);
    requestAnimationFrame(() => boutonRenommer.current?.focus());
  };
  useRaccourci({
    touche: 'Escape',
    libelle: 'Annuler le renommage',
    dansChamp: true,
    actif: edition && !renommage,
    action: () => {
      if (!formulaire.current?.contains(document.activeElement)) return false;
      fermerEdition();
    },
  });

  const renommer = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    demarrerRenommage(async () => {
      try {
        const resultat = await renommerScript(entrepriseId, scriptId, saisie);
        if (!resultat.ok) return setErreurNom(resultat.raison);
        setAnnonce(`Le script s’appelle maintenant « ${resultat.nom} ».`);
        fermerEdition();
      } catch {
        setErreurNom('Le renommage a échoué : réessaie.');
      }
    });
  };

  const basculer = (vers: boolean) =>
    demarrerArchivage(async () => {
      setErreur(null);
      try {
        const resultat = await basculerArchiveScript(entrepriseId, scriptId, vers);
        if (!resultat.ok) return setErreur(resultat.raison);
        confirmation.fermer();
        setAnnulable(vers);
        setAnnonce(vers ? 'Script archivé : il n’est plus proposé pour lancer un appel ou une campagne.' : 'Script réactivé : il est de nouveau proposé au lancement.');
      } catch {
        setErreur(vers ? 'L’archivage a échoué : réessaie.' : 'La réactivation a échoué : réessaie.');
      }
    });

  const utilise = usage.campagnes + usage.appelsEnCours > 0;
  const consequences = [
    usage.campagnes > 0 ? (usage.campagnes > 1 ? `${usage.campagnes} campagnes l’utilisent : elles gardent leur version et continuent.` : 'Une campagne l’utilise : elle garde sa version et continue.') : null,
    usage.appelsEnCours > 0 ? 'Un appel en ligne l’utilise : il va à son terme.' : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-2">
      {edition ? (
        <form ref={formulaire} onSubmit={renommer} aria-label="Renommer le script" className="grid gap-1">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label htmlFor="nom-script-renomme" className="sr-only">
              Nouveau nom du script
            </label>
            <Saisie
              id="nom-script-renomme"
              value={saisie}
              onChange={(ev) => setSaisie(ev.target.value)}
              autoFocus
              required
              maxLength={80}
              autoComplete="off"
              aria-invalid={erreurNom ? true : undefined}
              aria-describedby={erreurNom ? 'nom-script-renomme-erreur' : undefined}
              className="max-w-[26rem] min-w-[12rem] flex-1"
            />
            <div className="-mx-1.5 flex items-center gap-3 pointer-coarse:mx-0">
              <Action type="submit" ton="fort" touche="Entrée" enCours={renommage} libelleEnCours="Enregistrement…" disabled={renommage}>
                Renommer
              </Action>
              <Action ton="discret" touche="Échap" onClick={fermerEdition} disabled={renommage}>
                Annuler
              </Action>
            </div>
          </div>
          {erreurNom ? (
            <p id="nom-script-renomme-erreur" className="text-sm text-alerte">
              {erreurNom}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="-mx-1.5 flex flex-wrap items-center gap-x-8 gap-y-1">
          <Action
            ref={boutonRenommer}
            ton="discret"
            onClick={() => {
              setSaisie(nom);
              setAnnonce(null);
              setAnnulable(false);
              setEdition(true);
            }}
          >
            Renommer
          </Action>
          <Action
            ton="discret"
            enCours={archivage && !confirmation.ouverte}
            libelleEnCours={archive ? 'Réactivation…' : 'Archivage…'}
            disabled={archivage || confirmation.ouverte}
            aria-expanded={!archive && utilise ? confirmation.ouverte : undefined}
            onClick={() => {
              setAnnonce(null);
              setAnnulable(false);
              if (!archive && utilise) confirmation.ouvrir();
              else basculer(!archive);
            }}
          >
            {archive ? 'Réactiver' : 'Archiver'}
          </Action>
        </div>
      )}

      <Confirmation
        ouverte={confirmation.ouverte}
        question={`Archiver « ${nom} » ?`}
        libelleConfirmer="Archiver"
        enCours={archivage}
        libelleEnCours="Archivage…"
        erreur={confirmation.ouverte ? erreur : null}
        onConfirmer={() => basculer(true)}
        onAnnuler={confirmation.fermer}
        className="max-w-[44rem]"
      >
        {consequences.join(' ')} Le script ne sera plus proposé pour de nouveaux lancements ; tu peux le réactiver à tout moment.
      </Confirmation>

      {erreur && !confirmation.ouverte ? (
        <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 has-[[role=status]:empty]:-mt-2">
        <p role="status" className="text-sm text-encre-3">
          {annonce}
        </p>
        {annulable && archive ? (
          <span className="-mx-1.5">
            <Action ton="normal" enCours={archivage} libelleEnCours="Réactivation…" disabled={archivage} onClick={() => basculer(false)}>
              Annuler
            </Action>
          </span>
        ) : null}
      </div>
    </div>
  );
}
