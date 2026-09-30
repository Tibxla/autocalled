'use client';

import { unstable_rethrow } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action } from '@/components/ui';
import { archiverProspect, effacerLaPersonne, type FileEnAttente, reactiverProspect } from '../actions';

/**
 * Retirer un prospect (ADR 0013), sous le numéro de la fiche. Archiver est un frein réversible : immédiat, sans
 * confirmation, et Réactiver le défait ; mais s'il attend dans la file d'une campagne non terminée, l'archiver l'en
 * retire pour de bon : le serveur le dit (`aConfirmer`) et une confirmation en ligne nomme ces campagnes. Effacer la personne ne se défait pas : confirmation en ligne qui liste ce qui
 * sera effacé, compté par le serveur au rendu de la fiche ; refusée d'avance (action inerte, raison dessous) pendant
 * un appel avec elle ou sans sel d'opposition. Après l'effacement, la fiche n'existe plus : le serveur repart vers
 * la liste, qui montre le compte rendu.
 */
export function GestesProspect({
  entrepriseId,
  prospectId,
  nom,
  archive,
  effacement,
}: {
  entrepriseId: string;
  prospectId: string;
  nom: string;
  archive: boolean;
  effacement: { efface: string[]; reste: string[]; obstacle: string | null };
}) {
  const [archivage, demarrerArchivage] = useTransition();
  const [enCours, demarrer] = useTransition();
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurEffacement, setErreurEffacement] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const confirmationArchivage = useConfirmation();
  const [files, setFiles] = useState<FileEnAttente[]>([]);
  const declencheur = useRef<HTMLElement | null>(null);

  const fermerArchivage = () => {
    setFiles([]);
    confirmationArchivage.fermer();
  };

  const basculer = (confirmees: FileEnAttente[] = []) =>
    demarrerArchivage(async () => {
      setErreur(null);
      setAnnonce(null);
      try {
        if (archive) {
          const r = await reactiverProspect(entrepriseId, prospectId);
          if (!r.ok) return setErreur(r.raison);
          setAnnonce('Prospect réactivé : il peut de nouveau être appelé et ajouté à une campagne. Il ne revient dans aucune file.');
        } else {
          const r = await archiverProspect(
            entrepriseId,
            prospectId,
            confirmees.map((f) => f.id),
          );
          if (!r.ok) {
            // Il attend dans une file (ou dans une de plus depuis la question) : la confirmation les nomme, rien n'est fait.
            if ('aConfirmer' in r) {
              setFiles([...confirmees, ...r.aConfirmer]);
              if (!confirmationArchivage.ouverte) confirmationArchivage.ouvrir(declencheur.current);
              return;
            }
            return setErreur(r.raison);
          }
          fermerArchivage();
          setAnnonce(
            `Prospect archivé : il n’est plus proposé pour un appel ni une campagne.${
              r.retireDe ? ` Retiré de la file de ${r.retireDe > 1 ? `${r.retireDe} campagnes` : 'la campagne'}${r.terminees ? ', qui n’avait plus personne à appeler et se termine' : ''}.` : ''
            }`,
          );
        }
      } catch {
        setErreur(archive ? 'La réactivation a échoué : réessaie.' : 'L’archivage a échoué : réessaie.');
      }
    });

  const effacer = () =>
    demarrer(async () => {
      setErreurEffacement(null);
      try {
        const r = await effacerLaPersonne(entrepriseId, prospectId, true);
        // Sans erreur, le serveur a déjà changé de page.
        if (!r.ok) setErreurEffacement(r.raison);
      } catch (e) {
        unstable_rethrow(e);
        setErreurEffacement('L’effacement n’a pas abouti : relis la fiche avant de réessayer.');
      }
    });

  return (
    <div className="grid justify-items-start gap-2 border-t border-filet pt-4">
      {/* 24 px au moins entre le frein réversible et le geste irréversible. */}
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-6 gap-y-1">
        <Action
          ton="discret"
          enCours={archivage && !confirmationArchivage.ouverte}
          libelleEnCours={archive ? 'Réactivation…' : 'Archivage…'}
          aria-expanded={archive ? undefined : confirmationArchivage.ouverte}
          disabled={archivage || enCours || confirmationArchivage.ouverte}
          onClick={(e) => {
            declencheur.current = e.currentTarget;
            basculer();
          }}
        >
          {archive ? 'Réactiver' : 'Archiver'}
        </Action>
        <Action
          ton="alerte"
          aria-expanded={confirmation.ouverte}
          aria-disabled={effacement.obstacle ? true : undefined}
          aria-describedby={effacement.obstacle ? 'effacement-obstacle' : undefined}
          disabled={archivage || confirmation.ouverte || confirmationArchivage.ouverte}
          onClick={(e) => {
            if (effacement.obstacle) return;
            setErreurEffacement(null);
            confirmation.ouvrir(e.currentTarget);
          }}
        >
          Effacer la personne
        </Action>
      </div>
      {effacement.obstacle ? (
        <p id="effacement-obstacle" className="max-w-[44ch] text-sm text-encre-3">
          {effacement.obstacle}
        </p>
      ) : null}
      {erreur ? (
        <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
          {erreur}
        </p>
      ) : null}
      <p role="status" className="text-sm text-encre-2 empty:hidden">
        {annonce}
      </p>
      <ConfirmationArchivage
        className="justify-self-stretch"
        ouverte={confirmationArchivage.ouverte}
        nom={nom}
        files={files}
        enCours={archivage}
        onConfirmer={() => basculer(files)}
        onAnnuler={fermerArchivage}
      />
      <Confirmation
        className="justify-self-stretch"
        ouverte={confirmation.ouverte}
        ton="alerte"
        question={`Effacer ${nom} définitivement ?`}
        libelleConfirmer="Effacer la personne"
        enCours={enCours}
        libelleEnCours="Effacement…"
        erreur={erreurEffacement}
        onAnnuler={() => {
          setErreurEffacement(null);
          confirmation.fermer();
        }}
        onConfirmer={effacer}
      >
        <DetailEffacement efface={effacement.efface} reste={effacement.reste} />
      </Confirmation>
    </div>
  );
}

/** Le détail d'une confirmation d'effacement : ce qui part, puis ce qui reste et ce qu'il faudra finir à la main. */
export function DetailEffacement({ efface, reste }: { efface: string[]; reste: string[] }) {
  return (
    <div className="grid gap-2">
      <div>
        <p>Seront effacés :</p>
        <ul className="list-disc pl-4 marker:text-encre-3">
          {efface.map((ligne) => (
            <li key={ligne}>{ligne}</li>
          ))}
        </ul>
      </div>
      {reste.map((ligne) => (
        <p key={ligne}>{ligne}</p>
      ))}
    </div>
  );
}

/**
 * La confirmation d'un archivage qui retire le prospect de la file d'une ou plusieurs campagnes non terminées : elle
 * les nomme, dit celles qui se termineraient faute de personne d'autre à appeler, et que le retrait ne se défait pas.
 * Partagée par la fiche et la liste des prospects.
 */
export function ConfirmationArchivage({
  ouverte,
  nom,
  files,
  enCours,
  onConfirmer,
  onAnnuler,
  className = '',
}: {
  ouverte: boolean;
  nom: string;
  files: FileEnAttente[];
  enCours: boolean;
  onConfirmer: () => void;
  onAnnuler: () => void;
  className?: string;
}) {
  const plusieurs = files.length > 1;
  return (
    <Confirmation
      className={className}
      ouverte={ouverte}
      ton="alerte"
      question={`Archiver ${nom} et le retirer de ${plusieurs ? `${files.length} files` : 'la file'} ?`}
      libelleConfirmer="Archiver et retirer"
      enCours={enCours}
      libelleEnCours="Archivage…"
      onConfirmer={onConfirmer}
      onAnnuler={onAnnuler}
    >
      <div className="grid gap-2">
        <div>
          <p>{plusieurs ? 'Il attend dans la file de ces campagnes :' : 'Il attend dans la file de cette campagne :'}</p>
          <ul className="list-disc pl-4 marker:text-encre-3">
            {files.map((f) => (
              <li key={f.id}>
                {f.libelle}
                {f.derniere ? ' : il y est le dernier à appeler, elle se terminera' : ''}
              </li>
            ))}
          </ul>
        </div>
        <p>Il ne sera pas appelé dans {plusieurs ? 'ces campagnes' : 'cette campagne'}. Le retrait ne se défait pas : réactivé, il ne revient dans aucune file.</p>
      </div>
    </Confirmation>
  );
}
