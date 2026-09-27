'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Bouton, Message, Saisie } from '@/components/ui';
import { type Appairage, fermerAppairage, lireAppairage, oublierTelephone, ouvrirAppairage } from './actions';

export function PanneauAppairage({ initial }: { initial: Appairage | null }) {
  const router = useRouter();
  const [appairage, setAppairage] = useState<Appairage | null>(initial);
  const [adresse, setAdresse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, lancer] = useTransition();
  const ouvert = appairage?.etat === 'ouvert';

  // Pendant la fenêtre, on relit l'état pour afficher le code dès que le téléphone le propose.
  useEffect(() => {
    if (!ouvert) return;
    const minuterie = setInterval(async () => {
      const r = await lireAppairage();
      if (!r.ok) return;
      setAppairage(r.valeur);
      if (r.valeur.etat === 'reussi') router.refresh();
    }, 1500);
    return () => clearInterval(minuterie);
  }, [ouvert, router]);

  if (ouvert && appairage) {
    return (
      <div className="grid gap-4">
        <ol className="grid max-w-[62ch] list-decimal gap-1.5 pl-5 text-encre-2">
          <li>Sur le téléphone, ouvre les réglages Bluetooth et touche le serveur dans la liste des appareils.</li>
          <li>Compare le code qu’il affiche avec celui ci-dessous, puis accepte s’ils sont identiques.</li>
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
          onClick={() =>
            lancer(async () => {
              const r = await fermerAppairage();
              if (r.ok) setAppairage(r.valeur);
            })
          }
        >
          Fermer la fenêtre
        </Bouton>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        lancer(async () => {
          setErreur(null);
          const r = await ouvrirAppairage(adresse);
          if (r.ok) setAppairage(r.valeur);
          else setErreur(r.raison);
        });
      }}
    >
      {appairage?.etat === 'reussi' ? <Message ton="neutre">Téléphone appairé : il se reconnectera tout seul.</Message> : null}
      {appairage?.etat === 'expire' ? <Message ton="neutre">La fenêtre s’est refermée sans appairage.</Message> : null}
      <div className="grid gap-1.5">
        <label htmlFor="adresse-bluetooth" className="text-sm font-medium">
          Adresse Bluetooth du téléphone
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
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
      <Bouton type="submit" className="justify-self-start" disabled={enCours}>
        {enCours ? 'Ouverture…' : 'Ouvrir l’appairage (3 min)'}
      </Bouton>
    </form>
  );
}

/** Oublier le téléphone demande une confirmation dans la page, sans boîte de dialogue du navigateur. */
export function BoutonOublier({ adresse }: { adresse: string }) {
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, lancer] = useTransition();
  return (
    <div className="grid justify-items-start gap-2">
      {confirmer ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-encre-2">Le serveur oubliera ce téléphone ; il faudra l’appairer à nouveau.</span>
          <Bouton
            type="button"
            variante="secondaire"
            disabled={enCours}
            onClick={() =>
              lancer(async () => {
                const r = await oublierTelephone(adresse);
                if (!r.ok) setErreur(r.raison);
                setConfirmer(false);
              })
            }
          >
            Oublier
          </Bouton>
          <Bouton type="button" variante="discret" onClick={() => setConfirmer(false)}>
            Annuler
          </Bouton>
        </div>
      ) : (
        <Bouton type="button" variante="discret" className="-ml-3.5" onClick={() => setConfirmer(true)}>
          Oublier ce téléphone
        </Bouton>
      )}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </div>
  );
}
