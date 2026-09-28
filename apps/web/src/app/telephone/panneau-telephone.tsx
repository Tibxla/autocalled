'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Bouton, Message, Saisie } from '@/components/ui';
import { type Appairage, type EtatTelephone, fermerAppairage, lireAppairage, oublierTelephone, ouvrirAppairage } from './actions';

/**
 * Le téléphone passerelle et ce qu'on peut lui faire, au même endroit : sa fiche quand il est connu,
 * l'appairage quand il n'y en a pas, « Changer de téléphone » qui appaire le nouveau puis oublie l'ancien.
 */
export function PanneauTelephone({ telephone, initial }: { telephone: EtatTelephone; initial: Appairage | null }) {
  const router = useRouter();
  const [appairage, setAppairage] = useState<Appairage | null>(initial);
  const [changer, setChanger] = useState(false);
  const ouvert = appairage?.etat === 'ouvert';

  // Pendant la fenêtre, on relit l'état pour afficher le code dès que le téléphone le propose.
  useEffect(() => {
    if (!ouvert) return;
    const minuterie = setInterval(async () => {
      const r = await lireAppairage();
      if (!r.ok) return;
      setAppairage(r.valeur);
      if (r.valeur.etat !== 'ouvert') {
        setChanger(false);
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(minuterie);
  }, [ouvert, router]);

  if (ouvert && appairage) return <AppairageEnCours appairage={appairage} onFerme={setAppairage} />;

  const issue =
    appairage?.etat === 'reussi' ? (
      <Message ton="neutre">Téléphone appairé : il se reconnectera tout seul.</Message>
    ) : appairage?.etat === 'expire' ? (
      <Message ton="neutre">La fenêtre s’est refermée sans appairage.</Message>
    ) : null;

  if (!telephone.adresse) {
    return (
      <div className="grid gap-5">
        {issue}
        <p className="max-w-[62ch] text-encre-2">Aucun téléphone passerelle. Appaire le téléphone qui passera les appels de Mina.</p>
        <FormulaireAdresse remplacer={null} onOuvert={setAppairage} />
      </div>
    );
  }

  if (changer) {
    return (
      <div className="grid gap-5">
        <p className="max-w-[62ch] text-encre-2">
          Appaire le nouveau téléphone. Dès qu’il l’est, {telephone.nom || 'l’ancien'}{' '}
          <span className="font-mono text-sm text-encre-3">{telephone.adresse}</span> est oublié par le serveur.
        </p>
        <FormulaireAdresse remplacer={telephone.adresse} onOuvert={setAppairage} onAnnuler={() => setChanger(false)} />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {issue}
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_1fr]">
        <dt className="text-sm text-encre-3">Appareil</dt>
        <dd>
          {telephone.nom} <span className="font-mono text-sm text-encre-3">{telephone.adresse}</span>
        </dd>
        <dt className="text-sm text-encre-3">État</dt>
        <dd>
          {!telephone.connecte ? (
            <span className="text-encre-2">Pas connecté : hors de portée, ou Bluetooth coupé</span>
          ) : telephone.appelEnCours ? (
            <span className="text-antenne">Appel en cours</span>
          ) : (
            'Connecté, ligne libre'
          )}
        </dd>
        {telephone.connecte ? (
          <>
            <dt className="text-sm text-encre-3">Réseau</dt>
            <dd>
              {telephone.operateur || 'inconnu'}
              {telephone.signal !== undefined ? <span className="text-encre-3"> · signal {telephone.signal} %</span> : null}
            </dd>
            {telephone.batterie !== undefined ? (
              <>
                <dt className="text-sm text-encre-3">Batterie</dt>
                <dd>{telephone.batterie} %</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {telephone.plafond ? <Message ton="alerte">{telephone.plafond}</Message> : null}
      {telephone.connecte && telephone.signal !== undefined && telephone.signal < 40 ? (
        <Message ton="neutre">Signal faible : la voix risque de se dégrader. Rapproche le téléphone d’une fenêtre.</Message>
      ) : null}
      {telephone.appelEnCours ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Bouton type="button" variante="secondaire" onClick={() => setChanger(true)}>
            Changer de téléphone
          </Bouton>
          <BoutonOublier adresse={telephone.adresse} />
        </div>
      )}
    </div>
  );
}

function FormulaireAdresse({
  remplacer,
  onOuvert,
  onAnnuler,
}: {
  remplacer: string | null;
  onOuvert: (a: Appairage) => void;
  onAnnuler?: () => void;
}) {
  const [adresse, setAdresse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, lancer] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        lancer(async () => {
          setErreur(null);
          const r = await ouvrirAppairage(adresse, remplacer);
          if (r.ok) onOuvert(r.valeur);
          else setErreur(r.raison);
        });
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="adresse-bluetooth" className="text-sm font-medium">
          Adresse Bluetooth du {remplacer ? 'nouveau ' : ''}téléphone
        </label>
        <Saisie
          id="adresse-bluetooth"
          value={adresse}
          onChange={(e) => setAdresse(e.target.value)}
          placeholder="12:34:56:78:9A:BC"
          className="max-w-[16rem] font-mono"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <p className="text-sm text-encre-3">
          iPhone : Réglages → Général → Informations → Bluetooth. Android : Paramètres → À propos du téléphone → État.
        </p>
      </div>
      <p className="max-w-[62ch] text-sm text-encre-3">
        Le serveur devient visible pendant trois minutes et n’accepte que ce téléphone. Tu compareras le code affiché ici avec celui du
        téléphone avant d’accepter.
      </p>
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Bouton type="submit" disabled={enCours}>
          {enCours ? 'Ouverture…' : 'Ouvrir l’appairage (3 min)'}
        </Bouton>
        {onAnnuler ? (
          <Bouton type="button" variante="discret" onClick={onAnnuler}>
            Annuler
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}

function AppairageEnCours({ appairage, onFerme }: { appairage: Appairage; onFerme: (a: Appairage) => void }) {
  const [enCours, lancer] = useTransition();
  return (
    <div className="grid gap-5">
      <ol className="grid max-w-[62ch] list-decimal gap-1.5 pl-5 text-encre-2">
        <li>Sur le téléphone, ouvre les réglages Bluetooth et touche « server » dans la liste des appareils.</li>
        <li>Compare le code qu’il affiche avec celui ci-dessous, puis accepte s’ils sont identiques. S’ils diffèrent, refuse.</li>
        <li>S’il propose de partager les contacts, refuse : l’appel n’en a pas besoin.</li>
      </ol>
      <p className="grid gap-1">
        <span className="text-sm text-encre-3">Code attendu</span>
        <span className="font-mono text-3xl tracking-[0.2em]" aria-live="polite">
          {appairage.code ? `${appairage.code.slice(0, 3)} ${appairage.code.slice(3)}` : '— — —'}
        </span>
      </p>
      <p className="text-sm text-encre-3">
        Fenêtre ouverte pour <span className="font-mono">{appairage.adresse}</span>, encore {appairage.restantS ?? 0} s.
      </p>
      <Bouton
        type="button"
        variante="secondaire"
        className="justify-self-start"
        disabled={enCours}
        onClick={() =>
          lancer(async () => {
            const r = await fermerAppairage();
            if (r.ok) onFerme(r.valeur);
          })
        }
      >
        Fermer la fenêtre
      </Bouton>
    </div>
  );
}

/** Oublier le téléphone demande une confirmation dans la page, sans boîte de dialogue du navigateur. */
function BoutonOublier({ adresse }: { adresse: string }) {
  const router = useRouter();
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, lancer] = useTransition();
  if (!confirmer) {
    return (
      <Bouton type="button" variante="discret" onClick={() => setConfirmer(true)}>
        Oublier
      </Bouton>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-encre-2">Le serveur l’oubliera ; il faudra l’appairer à nouveau.</span>
      <Bouton
        type="button"
        variante="secondaire"
        disabled={enCours}
        onClick={() =>
          lancer(async () => {
            const r = await oublierTelephone(adresse);
            if (r.ok) router.refresh();
            else setErreur(r.raison);
            setConfirmer(false);
          })
        }
      >
        Oublier ce téléphone
      </Bouton>
      <Bouton type="button" variante="discret" onClick={() => setConfirmer(false)}>
        Annuler
      </Bouton>
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </span>
  );
}
