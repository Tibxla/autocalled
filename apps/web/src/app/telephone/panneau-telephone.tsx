'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action, Champ, LigneDefinition, Message, Saisie } from '@/components/ui';
import {
  type Appairage,
  type EtatTelephone,
  fermerAppairage,
  lireAppairage,
  oublierTelephone,
  ouvrirAppairage,
  reconnecterTelephone,
} from './actions';

/**
 * Le téléphone passerelle et ce qu'on peut lui faire, au même endroit : sa fiche quand il est connu,
 * l'appairage quand il n'y en a pas, « Changer de téléphone » qui appaire le nouveau puis oublie l'ancien.
 *
 * Les gestes passent par `gestes` (les server actions par défaut) : une démonstration locale peut rendre
 * chaque état, fenêtre d'appairage et confirmation comprises, sans toucher à la ligne.
 */

type Resultat<T> = { ok: true; valeur: T } | { ok: false; raison: string };

export type GestesTelephone = {
  ouvrir: (adresse: string, remplacer: string | null) => Promise<Resultat<Appairage>>;
  lire: () => Promise<Resultat<Appairage>>;
  fermer: () => Promise<Resultat<Appairage>>;
  oublier: (adresse: string) => Promise<{ ok: true } | { ok: false; raison: string }>;
  reconnecter: () => Promise<{ ok: true } | { ok: false; raison: string }>;
};

const GESTES_REELS: GestesTelephone = {
  ouvrir: ouvrirAppairage,
  lire: lireAppairage,
  fermer: fermerAppairage,
  oublier: oublierTelephone,
  reconnecter: reconnecterTelephone,
};

const LIBELLES_REGLAGES: Record<string, string> = {
  appelsParHeure: 'Appels par heure',
  appelsParJour: 'Appels par jour',
  pauseEntreAppelsS: 'Pause entre deux appels',
};

/**
 * Une raison renvoyée par la ligne, dite avec les mots de l'écran : jamais « pont » (terme d'architecture),
 * jamais de clé technique (« appelsParJour doit être entre 1 et 500 » devient « Appels par jour : entre 1 et 500. »).
 */
export function texteLigne(raison: string): string {
  if (/pont Bluetooth ne répond pas/i.test(raison)) return 'Le service de la ligne ne répond pas.';
  let texte = raison.trim();
  const cle = /^(appelsParHeure|appelsParJour|pauseEntreAppelsS) doit être (.+)$/.exec(texte);
  if (cle) texte = `${LIBELLES_REGLAGES[cle[1] ?? '']} : ${cle[2]}`;
  texte = texte.replace(/\b(appelsParHeure|appelsParJour|pauseEntreAppelsS)\b/g, (c) => LIBELLES_REGLAGES[c] ?? c);
  texte = texte
    .replace(/\bdu pont\b/gi, 'de la ligne')
    .replace(/\ble pont\b/gi, 'le service de la ligne')
    .replace(/\bpont\b/gi, 'service de la ligne');
  texte = texte.charAt(0).toLocaleUpperCase('fr-FR') + texte.slice(1);
  return /[.!?…]$/.test(texte) ? texte : `${texte}.`;
}

/** « ••:••:••:••:9A:BC » : l'écran peut être partagé, les captures peuvent finir dans le dépôt public. */
export function adresseReduite(adresse: string): string {
  const paires = adresse.split(':');
  if (paires.length !== 6) return adresse;
  return [...paires.slice(0, 4).map(() => '••'), ...paires.slice(4)].join(':');
}

/** Majuscules et deux-points insérés à la frappe : « 1234ab » devient « 12:34:AB ». */
function miseEnForme(saisie: string): string {
  const hexa = saisie
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
    .slice(0, 12);
  return (hexa.match(/.{1,2}/g) ?? []).join(':');
}

const ADRESSE_VALIDE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
const AIDE_ADRESSE = 'Six paires de caractères, par exemple 12:34:56:78:9A:BC.';
const SANS_REPONSE = {
  ok: false as const,
  raison: 'Le service de la ligne ne répond pas.',
};

export function PanneauTelephone({
  telephone,
  initial,
  gestes = GESTES_REELS,
}: {
  telephone: EtatTelephone;
  initial: Appairage | null;
  gestes?: GestesTelephone;
}) {
  const router = useRouter();
  const [appairage, setAppairage] = useState<Appairage | null>(initial);
  const [changer, setChanger] = useState(false);
  const [perdu, setPerdu] = useState(false);
  const [fermeture, setFermeture] = useState<string | null>(null);
  const [fermetureEnCours, lancerFermeture] = useTransition();
  const ouvert = appairage?.etat === 'ouvert';

  // Pendant la fenêtre, on relit l'appairage pour afficher le code dès que le téléphone le propose. Une
  // relecture à la fois : la suivante part 1,5 s après la réponse, jamais par-dessus une ligne lente.
  useEffect(() => {
    if (!ouvert) return;
    let vivant = true;
    let echecs = 0;
    let minuterie: ReturnType<typeof setTimeout>;
    const relire = async () => {
      const r = await gestes.lire().catch(() => SANS_REPONSE);
      if (!vivant) return;
      if (!r.ok) {
        echecs += 1;
        if (echecs >= 3) setPerdu(true);
      } else {
        echecs = 0;
        setPerdu(false);
        setAppairage(r.valeur);
        if (r.valeur.etat === 'reussi') setChanger(false);
        if (r.valeur.etat !== 'ouvert') {
          router.refresh();
          return;
        }
      }
      minuterie = setTimeout(relire, 1500);
    };
    minuterie = setTimeout(relire, 1500);
    return () => {
      vivant = false;
      clearTimeout(minuterie);
    };
  }, [ouvert, router, gestes]);

  const ouvrir = (a: Appairage) => {
    setFermeture(null);
    setPerdu(false);
    setAppairage(a);
  };

  if (ouvert && appairage) {
    return (
      <VueAppairage
        appairage={appairage}
        perdu={perdu}
        enCours={fermetureEnCours}
        onFermer={() =>
          lancerFermeture(async () => {
            const r = await gestes.fermer().catch(() => SANS_REPONSE);
            if (r.ok) {
              setAppairage(r.valeur);
              return;
            }
            // La ligne ne répond plus : on sort quand même de la fenêtre, le serveur la refermera seul.
            setAppairage({ ...appairage, etat: 'ferme' });
            setFermeture('La ligne n’a pas confirmé la fermeture : la fenêtre se refermera seule au bout de trois minutes.');
          })
        }
      />
    );
  }

  const issue =
    appairage?.etat === 'reussi' ? (
      <Message ton="neutre">Téléphone appairé : il se reconnectera tout seul.</Message>
    ) : appairage?.etat === 'expire' ? (
      <Message ton="alerte">La fenêtre s’est refermée sans appairage. Vérifie l’adresse, puis rouvre l’appairage.</Message>
    ) : fermeture ? (
      <Message ton="neutre">{fermeture}</Message>
    ) : null;
  // Après une expiration, le formulaire revient avec l'adresse déjà saisie et « Rouvrir l'appairage ».
  const adresseTentee = appairage?.etat === 'expire' ? (appairage.adresse ?? '') : '';

  if (!telephone.adresse) {
    return (
      <div className="grid gap-5">
        {issue}
        <p className="max-w-[62ch] text-base text-encre-2">
          Appaire le téléphone qui passera les appels de Mina : donne son adresse Bluetooth, puis compare le code qu’il affiche avec celui
          qui apparaîtra ici.
        </p>
        <FormulaireAdresse
          key={adresseTentee}
          remplacer={null}
          adresseInitiale={adresseTentee}
          onOuvert={ouvrir}
          ouvrirAppairage={gestes.ouvrir}
        />
      </div>
    );
  }

  if (changer && !telephone.appelEnCours) {
    return (
      <div className="grid gap-5">
        {issue}
        <p className="max-w-[62ch] text-base text-encre-2">
          Appaire le nouveau téléphone. Dès qu’il l’est, {telephone.nom || 'l’ancien'}{' '}
          <span className="font-mono text-sm text-encre-3">{adresseReduite(telephone.adresse)}</span> est oublié par le serveur.
        </p>
        <FormulaireAdresse
          key={adresseTentee}
          remplacer={telephone.adresse}
          adresseInitiale={adresseTentee}
          onOuvert={ouvrir}
          ouvrirAppairage={gestes.ouvrir}
          onAnnuler={() => {
            setChanger(false);
            setAppairage(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {issue}
      <DetailTelephone telephone={telephone} />
      {telephone.connecte && telephone.batterie !== undefined && palier(telephone.batterie) <= 1 ? (
        <Message ton="alerte">Batterie faible : branche le téléphone passerelle avant une campagne.</Message>
      ) : null}
      {/* On n'oublie pas le téléphone en plein appel réel : ces gestes disparaissent dès qu'un appel est relu en cours. */}
      {telephone.appelEnCours ? null : (
        <ActionsTelephone
          nom={telephone.nom || 'ce téléphone'}
          adresse={telephone.adresse}
          oublier={gestes.oublier}
          reconnecter={gestes.reconnecter}
          onChanger={() => {
            setAppairage(null);
            setChanger(true);
          }}
        />
      )}
    </div>
  );
}

/** oFono donne la batterie en paliers de 0 à 5 ; le service de la ligne la multiplie par 20. */
function palier(batterie: number): number {
  return Math.max(0, Math.min(5, Math.round(batterie / 20)));
}

export function DetailTelephone({ telephone }: { telephone: EtatTelephone }) {
  const operateur = telephone.operateur?.trim();
  const wifi = operateur ? /wi-?fi/i.test(operateur) : false;
  return (
    <dl className="border-t border-filet">
      <LigneDefinition intitule="Appareil">
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>{telephone.nom || 'Sans nom'}</span>
          {telephone.adresse ? <span className="font-mono text-xs text-encre-3">{adresseReduite(telephone.adresse)}</span> : null}
        </span>
        {telephone.adresse ? (
          <details className="mt-0.5 text-sm text-encre-3">
            <summary className="w-fit cursor-pointer decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
              Afficher l’adresse complète
            </summary>
            <span className="font-mono text-xs text-encre-2">{telephone.adresse}</span>
          </details>
        ) : null}
      </LigneDefinition>
      {telephone.connecte ? (
        <>
          <LigneDefinition intitule="Réseau">
            {operateur ? operateur : <span className="text-encre-3">opérateur inconnu</span>}
            <span className="block text-sm text-encre-3">
              {wifi ? 'Appels WiFi : il appelle par le Wi-Fi, pas par le réseau mobile. ' : ''}
              Nom lu à la connexion du téléphone.
            </span>
          </LigneDefinition>
          <LigneDefinition intitule="Signal">
            {telephone.signal !== undefined ? (
              <>
                <span className="font-mono">{telephone.signal} %</span>
                {telephone.signal < 40 ? (
                  <>
                    <span className="text-alerte"> · faible</span>
                    <span className="block text-sm text-encre-3">La voix risque de se dégrader. Rapproche le téléphone d’une fenêtre.</span>
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-encre-3">inconnu</span>
            )}
          </LigneDefinition>
          <LigneDefinition intitule="Batterie">
            {telephone.batterie !== undefined ? (
              <span className={`font-mono ${palier(telephone.batterie) <= 1 ? 'text-alerte' : ''}`}>{palier(telephone.batterie)}/5</span>
            ) : (
              <span className="text-encre-3">inconnue</span>
            )}
          </LigneDefinition>
        </>
      ) : (
        <LigneDefinition intitule="Connexion">
          <span className="text-encre-2">Réseau, signal et batterie se liront à sa reconnexion.</span>
        </LigneDefinition>
      )}
    </dl>
  );
}

/** Le temps que la liaison Bluetooth se refasse avant de relire la page. */
const ATTENTE_RECONNEXION_MS = 12_000;

/**
 * Relance la liaison Bluetooth à distance : utile quand le téléphone ne répond plus (liaison endormie) ou vient
 * de revenir à portée, sans avoir à le toucher. Personne n'est appelé : ni confirmation ni raccourci clavier.
 * « Reconnexion… » tient une douzaine de secondes, puis la page se relit.
 */
function useReconnexion(reconnecter: GestesTelephone['reconnecter'] = reconnecterTelephone) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (minuterie.current) clearTimeout(minuterie.current);
    },
    [],
  );
  const lancer = async () => {
    setErreur(null);
    setEnCours(true);
    const r = await reconnecter().catch(() => SANS_REPONSE);
    if (!r.ok) {
      setErreur(texteLigne(r.raison));
      setEnCours(false);
      return;
    }
    minuterie.current = setTimeout(() => {
      setEnCours(false);
      router.refresh();
    }, ATTENTE_RECONNEXION_MS);
  };
  return { enCours, erreur, lancer };
}

/**
 * « Reconnecter le téléphone » et son éventuelle erreur. Posée dans une rangée d'actions `flex-wrap` :
 * l'erreur passe sur sa propre ligne sous la rangée.
 */
export function ActionReconnecter({
  reconnecter,
  ton = 'normal',
}: {
  reconnecter?: GestesTelephone['reconnecter'];
  ton?: 'normal' | 'discret';
}) {
  const { enCours, erreur, lancer } = useReconnexion(reconnecter);
  return (
    <>
      <Action ton={ton} enCours={enCours} libelleEnCours="Reconnexion…" disabled={enCours} onClick={lancer}>
        Reconnecter le téléphone
      </Action>
      {erreur ? (
        <Message ton="alerte" className="mx-1.5 basis-full">
          {erreur}
        </Message>
      ) : null}
    </>
  );
}

/** Rangée des gestes sur le téléphone connu : reconnecter (réversible, sans confirmation), changer, oublier. */
function ActionsTelephone({
  nom,
  adresse,
  oublier,
  reconnecter,
  onChanger,
}: {
  nom: string;
  adresse: string;
  oublier: GestesTelephone['oublier'];
  reconnecter: GestesTelephone['reconnecter'];
  onChanger: () => void;
}) {
  const router = useRouter();
  const confirmation = useConfirmation();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, lancer] = useTransition();
  return (
    <div className="grid gap-3">
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <ActionReconnecter reconnecter={reconnecter} />
        <Action ton="normal" onClick={onChanger} disabled={confirmation.ouverte}>
          Changer de téléphone
        </Action>
        <Action
          ton="discret"
          aria-expanded={confirmation.ouverte}
          onClick={(e) => {
            setErreur(null);
            confirmation.ouvrir(e.currentTarget);
          }}
        >
          Oublier ce téléphone
        </Action>
      </div>
      <Confirmation
        ouverte={confirmation.ouverte}
        question={`Oublier ${nom} ?`}
        libelleConfirmer="Oublier ce téléphone"
        ton="alerte"
        enCours={enCours}
        libelleEnCours="Oubli…"
        erreur={erreur}
        onAnnuler={confirmation.fermer}
        onConfirmer={() =>
          lancer(async () => {
            const r = await oublier(adresse).catch(() => SANS_REPONSE);
            if (!r.ok) {
              setErreur(texteLigne(r.raison));
              return;
            }
            confirmation.fermer();
            router.refresh();
          })
        }
      >
        Le serveur l’oubliera. Mina ne pourra plus appeler par le téléphone jusqu’au prochain appairage ; une campagne en cours se mettra en
        pause au prochain appel.
      </Confirmation>
    </div>
  );
}

function FormulaireAdresse({
  remplacer,
  adresseInitiale,
  onOuvert,
  onAnnuler,
  ouvrirAppairage: ouvrir,
}: {
  remplacer: string | null;
  adresseInitiale: string;
  onOuvert: (a: Appairage) => void;
  onAnnuler?: () => void;
  ouvrirAppairage: GestesTelephone['ouvrir'];
}) {
  const [adresse, setAdresse] = useState(adresseInitiale);
  const [erreurChamp, setErreurChamp] = useState<string | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, lancer] = useTransition();
  const rouvrir = adresseInitiale !== '';

  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ADRESSE_VALIDE.test(adresse)) {
      setErreurChamp(AIDE_ADRESSE);
      e.currentTarget.querySelector<HTMLInputElement>('#adresse-bluetooth')?.focus();
      return;
    }
    lancer(async () => {
      setErreur(null);
      const r = await ouvrir(adresse, remplacer).catch(() => SANS_REPONSE);
      if (r.ok) onOuvert(r.valeur);
      else setErreur(texteLigne(r.raison));
    });
  };

  return (
    // Une adresse en cours de saisie suspend le relevé automatique de la page (releve-etat.tsx).
    <form className="grid gap-4" noValidate onSubmit={envoyer} data-garde-releve={adresse ? '' : undefined} aria-busy={enCours}>
      <div className="max-w-[36rem]">
        <Champ
          libelle={`Adresse Bluetooth du ${remplacer ? 'nouveau ' : ''}téléphone`}
          htmlFor="adresse-bluetooth"
          aide={`${AIDE_ADRESSE} iPhone : Réglages, Général, Informations, Bluetooth. Android : Paramètres, À propos du téléphone, État.`}
          erreur={erreurChamp}
        >
          <Saisie
            id="adresse-bluetooth"
            name="adresse"
            value={adresse}
            onChange={(e) => {
              setAdresse(miseEnForme(e.target.value));
              setErreurChamp(undefined);
            }}
            placeholder="12:34:56:78:9A:BC"
            className="max-w-[14rem] font-mono"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={17}
            required
          />
        </Champ>
      </div>
      <p className="max-w-[62ch] text-sm text-encre-3">
        Le serveur devient visible pendant trois minutes et n’accepte que ce téléphone. Tu compareras le code affiché ici avec celui du
        téléphone avant d’accepter.
      </p>
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Action type="submit" ton="fort" enCours={enCours} libelleEnCours="Ouverture…" disabled={enCours}>
          {rouvrir ? 'Rouvrir l’appairage (3 min)' : 'Ouvrir l’appairage (3 min)'}
        </Action>
        {onAnnuler ? (
          <Action ton="discret" onClick={onAnnuler} disabled={enCours}>
            Annuler
          </Action>
        ) : null}
      </div>
    </form>
  );
}

/** « 2:41 ». */
function restant(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** La fenêtre d'appairage ouverte : étapes, code attendu lisible depuis le téléphone qu'on tient à côté. */
export function VueAppairage({
  appairage,
  perdu,
  enCours,
  onFermer,
}: {
  appairage: Appairage;
  perdu: boolean;
  enCours: boolean;
  onFermer: () => void;
}) {
  return (
    <div className="grid gap-5" data-garde-releve="">
      <ol className="grid max-w-[62ch] gap-2 text-base text-encre-2">
        {[
          'Sur le téléphone, ouvre les réglages Bluetooth et touche « server » dans la liste des appareils.',
          'Compare le code qu’il affiche avec celui ci-dessous, puis accepte s’ils sont identiques. S’ils diffèrent, refuse.',
          'S’il propose de partager les contacts, refuse : l’appel n’en a pas besoin.',
        ].map((etape, i) => (
          <li key={etape} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
            <span className="font-mono text-sm text-encre-3">{i + 1}</span>
            <span>{etape}</span>
          </li>
        ))}
      </ol>
      <div className="grid justify-items-center gap-2 rounded-md bg-surface px-4 py-6 text-center">
        <span className="text-sm text-encre-3">Code attendu</span>
        <span aria-live="polite" className="flex min-h-[42px] items-center">
          {appairage.code ? (
            <span className="font-mono text-3xl tracking-[0.2em] text-encre">
              {appairage.code.slice(0, 3)} {appairage.code.slice(3)}
            </span>
          ) : (
            <span className="text-md text-encre-3">en attente du téléphone</span>
          )}
        </span>
        <span className="text-sm text-encre-3">
          Fenêtre ouverte pour <span className="font-mono">{adresseReduite(appairage.adresse ?? '')}</span>, encore{' '}
          <span className="font-mono text-encre-2">{restant(appairage.restantS ?? 0)}</span>
        </span>
      </div>
      {perdu ? <Message ton="alerte">Plus de nouvelles de la ligne : la fenêtre s’est peut-être refermée.</Message> : null}
      <div className="-mx-1.5">
        <Action ton="normal" enCours={enCours} libelleEnCours="Fermeture…" disabled={enCours} onClick={onFermer}>
          Fermer la fenêtre
        </Action>
      </div>
    </div>
  );
}
