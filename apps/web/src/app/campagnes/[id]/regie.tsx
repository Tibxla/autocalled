'use client';

import type { StatutCampagne } from '@autocalled/domain';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AppelEnDirect } from '@/components/appel-en-direct';
import { appelFini, appelLance, decompteAttendu, ENCHAINEMENT_INITIAL, type EtatEnchainement } from '@/components/enchainement-campagne';
import { BandeAppel, type IdentiteAppel } from '@/components/bande-appel';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import type { ReglagesLigne } from '@/components/garde-fous';
import { Action, LienAction, Message } from '@/components/ui';
import { cloreAppelDeCampagne, lancerCampagne, ouvrirAppelSuivant, suspendreCampagne, terminerAvantLaFin } from '../actions';
import { phraseEstimation, phrasePlafonds, Recapitulatif, type ProspectRecapitulatif } from './recapitulatif';

/**
 * La régie d'une campagne, selon sa ligne et son statut.
 * - Téléphone : le serveur enchaîne ; la page suit l'appel en cours par la bande d'appel commune et se relit
 *   toutes les 3 s. Lancer et Reprendre passent par une confirmation (des numéros vont sonner).
 * - Ligne navigateur : l'appel vit dans cette page. Rien ne part au chargement ni au retour sur la page : le
 *   premier appel attend un geste de l'opérateur, les suivants s'enchaînent ensuite après un décompte de 5 s.
 * - Simulation : le serveur enchaîne seul, la page se relit.
 * Suspendre est un frein réversible : immédiat, sans confirmation ni touche.
 * Terminer ferme la file pour de bon : confirmation en ligne. Il ne coupe aucun appel : l'appel en cours va à
 * son terme et la campagne se termine avec lui.
 */

export interface EtatPont {
  etat: 'joignable' | 'injoignable' | 'deconnecte' | 'inconnu';
  plafond: string | null;
  reglages: ReglagesLigne | null;
}

export interface RaisonSuspension {
  texte: string;
  ton: 'alerte' | 'neutre';
  lienTelephone?: boolean;
}

type Ligne = 'navigateur' | 'bluetooth' | 'simulation' | 'twilio';
type Prochain = { id: string; nom: string; societe: string | null };

interface ProprietesRegie {
  campagneId: string;
  statut: StatutCampagne;
  ligne: Ligne;
  entrepriseId: string;
  entreprise: { nom: string; slug: string };
  versionScriptId: string;
  version: string;
  prochain: Prochain | null;
  restants: number;
  enAppel: boolean;
  appelOuvertNavigateur: string | null;
  appelTelephone: {
    id: string;
    statut: 'en-cours' | 'traitement';
    debutLe: string;
    finLe: string | null;
    conversation: boolean;
    identite: IdentiteAppel;
  } | null;
  pont: EtatPont | null;
  passes24h: number | null;
  raison: RaisonSuspension | null;
  recapitulatif: { prospects: ProspectRecapitulatif[]; autorises: number } | null;
  /** Terminée pendant un appel : elle se termine quand cet appel finit. */
  seTermine: boolean;
}

const CHANGEMENT = 'La campagne a changé d’état entre-temps.';
const PAUSE_SECONDES = 5;

/** Un geste sur la campagne : toute erreur (transition refusée, double clic, second onglet) relit la page. */
function useGeste() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const agir = (geste: () => Promise<void>, suite: { succes?: () => void; toujours?: () => void } = {}) =>
    demarrer(async () => {
      setErreur(null);
      try {
        await geste();
        suite.succes?.();
      } catch {
        setErreur(CHANGEMENT);
        router.refresh();
      }
      suite.toujours?.();
    });
  return { erreur, enCours, agir };
}

/** Ce qui empêche un appel téléphone de partir maintenant, d'après le pont ; null si rien ne l'empêche. */
function blocageLigne(pont: EtatPont | null): { texte: string; lienTelephone: boolean } | null {
  if (!pont) return null;
  if (pont.etat === 'injoignable') return { texte: 'Ligne injoignable : aucun appel ne peut partir par le téléphone passerelle.', lienTelephone: true };
  if (pont.etat === 'deconnecte') return { texte: 'Téléphone passerelle déconnecté : aucun appel ne peut partir.', lienTelephone: true };
  if (pont.plafond) return { texte: pont.plafond, lienTelephone: true };
  return null;
}

function Blocage({ blocage }: { blocage: { texte: string; lienTelephone: boolean } }) {
  return (
    <Message ton="alerte" action={blocage.lienTelephone ? <LienAction href="/telephone">Ouvrir Téléphone</LienAction> : undefined}>
      {blocage.texte}
    </Message>
  );
}

function Raison({ raison }: { raison: RaisonSuspension }) {
  if (raison.ton === 'neutre') return <p className="text-base text-encre-2">{raison.texte}</p>;
  return (
    <Message ton="alerte" action={raison.lienTelephone ? <LienAction href="/telephone">Ouvrir Téléphone</LienAction> : undefined}>
      {raison.texte}
    </Message>
  );
}

/** « Marc Dupont, Boulangerie Dupont ». */
function nomComplet(p: Prochain): string {
  return p.societe ? `${p.nom}, ${p.societe}` : p.nom;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 max-sm:grid max-sm:justify-items-start">{children}</div>;
}

function Suspendre({ onClick, enCours }: { onClick: () => void; enCours: boolean }) {
  return (
    <>
      <Action onClick={onClick} disabled={enCours} enCours={enCours} libelleEnCours="Suspension…">
        Suspendre
      </Action>
      <span className="px-1.5 text-sm text-encre-3">L’appel en cours va à son terme, aucun autre ne part.</span>
    </>
  );
}

export function Regie(props: ProprietesRegie) {
  const { statut, ligne, enAppel } = props;
  const router = useRouter();

  // Le serveur enchaîne hors de la page (téléphone, simulation) : relecture toutes les 3 s, onglet visible
  // seulement, et tout de suite au retour sur l'onglet.
  const suivre = ligne !== 'navigateur' && (statut === 'en-cours' || (statut === 'en-pause' && enAppel));
  useEffect(() => {
    if (!suivre) return;
    const relire = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const minuterie = setInterval(relire, 3000);
    document.addEventListener('visibilitychange', relire);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', relire);
    };
  }, [suivre, router]);

  if (statut === 'terminee') return null;

  let contenu: React.ReactNode;
  if (ligne === 'navigateur') contenu = <RegieNavigateur {...props} />;
  else if (statut === 'prete') contenu = <Lancement {...props} />;
  else if (ligne === 'bluetooth') contenu = <RegieTelephone {...props} />;
  else if (ligne === 'simulation') contenu = <RegieSimulation {...props} />;
  else contenu = <RegieTwilio {...props} />;

  return (
    <section aria-labelledby="titre-regie" className="grid gap-5 border-b border-filet pb-8">
      <h2 id="titre-regie" className="sr-only">
        Régie de la campagne
      </h2>
      {props.seTermine ? (
        <p role="status" className="text-base text-encre-2">
          Campagne terminée à la fin de l’appel en cours : plus aucun prospect ne sera appelé.
        </p>
      ) : null}
      {contenu}
      {!props.seTermine && props.restants > 0 ? <Terminer campagneId={props.campagneId} restants={props.restants} enAppel={enAppel} /> : null}
    </section>
  );
}

/** Terminer avant la fin : les prospects restants ne seront pas appelés ; l'appel en cours, lui, va à son terme. */
function Terminer({ campagneId, restants, enAppel }: { campagneId: string; restants: number; enAppel: boolean }) {
  const confirmation = useConfirmation();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const fermer = () => {
    setErreur(null);
    confirmation.fermer();
  };
  return (
    <div className="grid justify-items-start gap-2">
      <Actions>
        <Action ton="discret" aria-expanded={confirmation.ouverte} onClick={(e) => confirmation.ouvrir(e.currentTarget)}>
          Terminer la campagne
        </Action>
        <span className="px-1.5 text-sm text-encre-3">Les prospects restants ne seront pas appelés ; aucun appel n’est coupé.</span>
      </Actions>
      <Confirmation
        className="justify-self-stretch"
        ouverte={confirmation.ouverte}
        question="Terminer la campagne maintenant ?"
        libelleConfirmer="Terminer la campagne"
        enCours={enCours}
        libelleEnCours="Clôture…"
        erreur={erreur}
        onAnnuler={fermer}
        onConfirmer={() =>
          demarrer(async () => {
            setErreur(null);
            try {
              const r = await terminerAvantLaFin(campagneId);
              if (!r.ok) return setErreur(r.raison);
              confirmation.fermer();
            } catch {
              setErreur('La clôture n’a pas abouti : la campagne continue. Réessaie.');
            }
          })
        }
      >
        <p>
          {restants} prospect{restants > 1 ? 's' : ''} encore à appeler ne {restants > 1 ? 'le seront' : 'le sera'} pas : {restants > 1 ? 'ils restent' : 'il reste'}{' '}
          dans la file, marqué{restants > 1 ? 's' : ''} non appelé{restants > 1 ? 's' : ''}.
          {enAppel ? ' L’appel en cours va à son terme ; la campagne se termine avec lui.' : ''}
        </p>
        <p className="mt-1">Une campagne terminée ne se relance pas : pour appeler ces prospects plus tard, crée une nouvelle campagne.</p>
      </Confirmation>
    </div>
  );
}

/* ------------------------------------------------------------------ prête : téléphone, simulation, Twilio */

function Lancement({ campagneId, ligne, entreprise, version, recapitulatif, pont, passes24h }: ProprietesRegie) {
  const { erreur, enCours, agir } = useGeste();
  const confirmation = useConfirmation();
  const prospects = recapitulatif?.prospects ?? [];
  const autorises = recapitulatif?.autorises ?? 0;
  const blocage = ligne === 'bluetooth' ? blocageLigne(pont) : null;
  const vide = autorises === 0;

  let action: React.ReactNode;
  if (ligne === 'bluetooth') {
    const estime = phraseEstimation(autorises, pont?.reglages ?? null, passes24h);
    action = (
      <div className="grid justify-items-start gap-3">
        {blocage ? <Blocage blocage={blocage} /> : null}
        <Actions>
          <Action
            ton="fort"
            disabled={Boolean(blocage) || vide || enCours}
            aria-expanded={confirmation.ouverte}
            onClick={(e) => confirmation.ouvrir(e.currentTarget)}
          >
            Lancer {autorises} appel{autorises > 1 ? 's' : ''} sur le téléphone
          </Action>
        </Actions>
        <Confirmation
          ouverte={confirmation.ouverte}
          question="Lancer la campagne sur le téléphone passerelle ?"
          libelleConfirmer={`Lancer ${autorises} appel${autorises > 1 ? 's' : ''}`}
          enCours={enCours}
          libelleEnCours="Lancement…"
          onAnnuler={confirmation.fermer}
          onConfirmer={() => agir(() => lancerCampagne(campagneId), { toujours: confirmation.fermer })}
        >
          <p>
            {autorises} numéro{autorises > 1 ? 's vont' : ' va'} sonner l’un après l’autre ({entreprise.nom} · {version}).{' '}
            {phrasePlafonds(pont?.reglages ?? null, passes24h)}
          </p>
          {estime ? <p className="mt-1">{estime}</p> : null}
        </Confirmation>
      </div>
    );
  } else if (ligne === 'simulation') {
    action = (
      <Actions>
        <Action ton="fort" disabled={vide || enCours} enCours={enCours} libelleEnCours="Lancement…" onClick={() => agir(() => lancerCampagne(campagneId))}>
          Lancer la simulation ({autorises} appel{autorises > 1 ? 's' : ''} simulé{autorises > 1 ? 's' : ''})
        </Action>
      </Actions>
    );
  } else {
    action = <p className="text-sm text-encre-3">Les campagnes sur Twilio ne se lancent pas depuis cette page.</p>;
  }

  return (
    <>
      <Recapitulatif ligne={ligne} prospects={prospects} autorises={autorises} reglages={pont?.reglages ?? null} passes24h={passes24h} action={action} />
      {vide && prospects.length > 0 ? (
        <Message ton="alerte">Aucun numéro de cette campagne n’est autorisé : tous seraient sautés, rien ne partirait.</Message>
      ) : null}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </>
  );
}

/* ------------------------------------------------------------------ téléphone en cours ou suspendue */

function RegieTelephone({
  campagneId,
  statut,
  entreprise,
  version,
  prochain,
  restants,
  appelTelephone,
  pont,
  passes24h,
  raison,
}: ProprietesRegie) {
  const { erreur, enCours, agir } = useGeste();
  const confirmation = useConfirmation();
  const blocage = blocageLigne(pont);
  const pause = pont?.reglages?.pauseEntreAppelsS;

  return (
    <>
      {statut === 'en-pause' && raison ? <Raison raison={raison} /> : null}

      {appelTelephone ? (
        <BandeAppel
          key={appelTelephone.id}
          appelId={appelTelephone.id}
          variante="bande"
          identite={appelTelephone.identite}
          debutLe={appelTelephone.debutLe}
          statut={appelTelephone.statut}
          finLe={appelTelephone.finLe}
          conversation={appelTelephone.conversation}
        />
      ) : statut === 'en-cours' ? (
        <div className="grid gap-2">
          {prochain ? (
            <p className="text-lg text-balance">
              <span className="text-encre-3">Suivant : </span>
              <span className="font-medium">{nomComplet(prochain)}</span>
              <span className="text-encre-2">
                , après la pause {pause ? <>de <span className="font-mono">{pause}</span> s </> : null}réglée sur Téléphone.
              </span>
            </p>
          ) : (
            <p className="text-lg text-encre-2">Plus aucun prospect à appeler : la campagne se termine.</p>
          )}
          {blocage ? <Blocage blocage={blocage} /> : null}
        </div>
      ) : null}

      {statut === 'en-cours' ? (
        <Actions>
          <Suspendre enCours={enCours} onClick={() => agir(() => suspendreCampagne(campagneId))} />
        </Actions>
      ) : (
        <div className="grid justify-items-start gap-3">
          {blocage && raison?.lienTelephone !== true ? <Blocage blocage={blocage} /> : null}
          <Actions>
            <Action
              ton="fort"
              disabled={Boolean(blocage) || restants === 0 || enCours}
              aria-expanded={confirmation.ouverte}
              onClick={(e) => confirmation.ouvrir(e.currentTarget)}
            >
              Reprendre
            </Action>
            {blocage ? <span className="px-1.5 text-sm text-encre-3">Reprise impossible tant que la ligne ne peut pas appeler.</span> : null}
          </Actions>
          <Confirmation
            ouverte={confirmation.ouverte}
            question="Reprendre la campagne ?"
            libelleConfirmer={`Reprendre (${restants} restant${restants > 1 ? 's' : ''})`}
            enCours={enCours}
            libelleEnCours="Reprise…"
            onAnnuler={confirmation.fermer}
            onConfirmer={() => agir(() => lancerCampagne(campagneId), { toujours: confirmation.fermer })}
          >
            <p>
              {prochain ? (
                <>
                  La campagne reprend à {nomComplet(prochain)} : {restants} appel{restants > 1 ? 's' : ''} restant{restants > 1 ? 's' : ''}, sur le
                  téléphone passerelle ({entreprise.nom} · {version}).{' '}
                </>
              ) : null}
              {phrasePlafonds(pont?.reglages ?? null, passes24h)}
            </p>
            {phraseEstimation(restants, pont?.reglages ?? null, passes24h) ? (
              <p className="mt-1">{phraseEstimation(restants, pont?.reglages ?? null, passes24h)}</p>
            ) : null}
          </Confirmation>
        </div>
      )}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </>
  );
}

/* ------------------------------------------------------------------ simulation */

function RegieSimulation({ campagneId, statut, restants, raison }: ProprietesRegie) {
  const { erreur, enCours, agir } = useGeste();
  return (
    <>
      {statut === 'en-cours' ? (
        <p className="text-base text-encre-2">Le serveur enchaîne les appels simulés ; la file se met à jour toute seule.</p>
      ) : raison ? (
        <Raison raison={raison} />
      ) : null}
      <Actions>
        {statut === 'en-cours' ? (
          <Suspendre enCours={enCours} onClick={() => agir(() => suspendreCampagne(campagneId))} />
        ) : (
          <Action
            ton="fort"
            disabled={restants === 0 || enCours}
            enCours={enCours}
            libelleEnCours="Reprise…"
            onClick={() => agir(() => lancerCampagne(campagneId))}
          >
            Reprendre la simulation ({restants} restant{restants > 1 ? 's' : ''})
          </Action>
        )}
      </Actions>
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </>
  );
}

/* ------------------------------------------------------------------ Twilio (ancienne ligne) */

function RegieTwilio({ campagneId, statut, raison }: ProprietesRegie) {
  const { erreur, enCours, agir } = useGeste();
  return (
    <>
      {statut === 'en-pause' && raison ? <Raison raison={raison} /> : null}
      <p className="text-base text-encre-2">Téléphone (Twilio) : cette page ne pilote pas l’enchaînement des appels de cette ligne.</p>
      {statut === 'en-cours' ? (
        <Actions>
          <Suspendre enCours={enCours} onClick={() => agir(() => suspendreCampagne(campagneId))} />
        </Actions>
      ) : null}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </>
  );
}

/* ------------------------------------------------------------------ ligne navigateur */

function RegieNavigateur(props: ProprietesRegie) {
  const { campagneId, statut, entrepriseId, versionScriptId, prochain, restants, appelOuvertNavigateur, raison, recapitulatif } = props;
  const router = useRouter();
  const { erreur, enCours, agir } = useGeste();
  // Premier geste de l'opérateur dans cette page : sans lui, aucun appel ne part (ni au chargement, ni au
  // retour, ni derrière une connexion ratée).
  const [enchainement, setEnchainement] = useState<EtatEnchainement>(ENCHAINEMENT_INITIAL);
  const geste = enchainement.geste;
  const setGeste = (valeur: boolean) => setEnchainement((e) => ({ ...e, geste: valeur, echec: valeur ? null : e.echec }));
  // Le prospect de l'appel qui vit dans cette page, gardé ici : un rafraîchissement ne le démonte pas.
  const [direct, setDirect] = useState<Prochain | null>(null);
  const [appelId, setAppelId] = useState<string | null>(null);

  const appeler = (p: Prochain) => {
    setEnchainement((e) => appelLance(e, p.id));
    setDirect(p);
  };

  const resteOuvert = appelOuvertNavigateur !== null && appelOuvertNavigateur !== appelId && direct === null;

  let corps: React.ReactNode;
  if (direct) {
    corps = (
      <>
        <AppelEnDirect
          key={direct.id}
          entrepriseId={entrepriseId}
          prospectId={direct.id}
          prospectNom={direct.nom}
          versionScriptId={versionScriptId}
          campagneId={campagneId}
          demarrageAuto
          ouvrir={async () => {
            // Le prospect affiché : si la file a changé entre-temps (Sauter, Retirer), rien ne part.
            const r = await ouvrirAppelSuivant(campagneId, direct.id);
            if (r.ok) setAppelId(r.appelId);
            return r;
          }}
          clore={(id) => cloreAppelDeCampagne(campagneId, id)}
          onFin={(_id, fin) => {
            setEnchainement((e) => appelFini(e, fin));
            setDirect(null);
            setAppelId(null);
            router.refresh();
          }}
        />
        {statut === 'en-cours' ? (
          <Actions>
            <Suspendre enCours={enCours} onClick={() => agir(() => suspendreCampagne(campagneId))} />
          </Actions>
        ) : (
          <p className="text-sm text-encre-3">Suspendue : cet appel va à son terme, aucun autre ne partira.</p>
        )}
      </>
    );
  } else if (statut === 'prete') {
    corps = (
      <Recapitulatif
        ligne="navigateur"
        prospects={recapitulatif?.prospects ?? []}
        autorises={recapitulatif?.autorises ?? 0}
        action={
          <Actions>
            <Action
              ton="fort"
              disabled={enCours || (recapitulatif?.autorises ?? 0) === 0}
              enCours={enCours}
              libelleEnCours="Lancement…"
              onClick={() => agir(() => lancerCampagne(campagneId), { succes: () => setGeste(true) })}
            >
              Lancer la campagne
            </Action>
            <span className="px-1.5 text-sm text-encre-3">Le premier appel part 5 s après, au micro de cet ordinateur.</span>
          </Actions>
        }
      />
    );
  } else if (resteOuvert && appelOuvertNavigateur) {
    corps = (
      <>
        <p className="text-base text-encre-2">Un appel de cette campagne est resté ouvert : la page a sans doute été fermée pendant l’appel.</p>
        <Actions>
          <Action
            enCours={enCours}
            libelleEnCours="Clôture…"
            disabled={enCours}
            onClick={() => agir(() => cloreAppelDeCampagne(campagneId, appelOuvertNavigateur))}
          >
            Clore cet appel et continuer
          </Action>
        </Actions>
      </>
    );
  } else if (statut === 'en-pause') {
    corps = (
      <>
        {raison ? <Raison raison={raison} /> : null}
        <Actions>
          <Action
            ton="fort"
            disabled={restants === 0 || enCours}
            enCours={enCours}
            libelleEnCours="Reprise…"
            onClick={() => agir(() => lancerCampagne(campagneId), { succes: () => setGeste(true) })}
          >
            Reprendre
          </Action>
          {prochain ? <span className="px-1.5 text-sm text-encre-3">Le prochain appel, {prochain.nom}, part 5 s après.</span> : null}
        </Actions>
      </>
    );
  } else if (!prochain) {
    corps = <p className="text-base text-encre-2">Plus aucun prospect à appeler.</p>;
  } else if (!geste) {
    corps = (
      <>
        {enchainement.echec ? (
          <Message ton="alerte" titre="L’appel a été clos sans conversation : rien ne part avant que tu appelles de nouveau.">
            {enchainement.echec}
          </Message>
        ) : null}
        <div className="grid gap-1">
          <p className="text-lg text-balance">
            <span className="text-encre-3">Prochain : </span>
            <span className="font-medium">{nomComplet(prochain)}</span>
          </p>
          <p className="text-sm text-encre-3">Rien ne part tant que tu n’appelles pas ; ensuite, les appels s’enchaînent après un décompte de 5 s.</p>
        </div>
        <Actions>
          <Action ton="fort" onClick={() => appeler(prochain)}>
            Appeler maintenant
          </Action>
          <Suspendre enCours={enCours} onClick={() => agir(() => suspendreCampagne(campagneId))} />
        </Actions>
      </>
    );
  } else if (decompteAttendu(enchainement, prochain.id)) {
    corps = (
      <>
        <Decompte key={prochain.id} nom={prochain.nom} onFini={() => appeler(prochain)} onArreter={() => setGeste(false)} />
        <Actions>
          <Suspendre enCours={enCours} onClick={() => agir(() => suspendreCampagne(campagneId))} />
        </Actions>
      </>
    );
  } else {
    corps = <p className="text-base text-encre-3">Appel terminé : rapatriement et analyse…</p>;
  }

  return (
    <>
      {corps}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </>
  );
}

/** Court décompte avant l'appel suivant, seulement après un premier geste ; remonté à chaque prospect par sa clé. */
function Decompte({ nom, onFini, onArreter }: { nom: string; onFini: () => void; onArreter: () => void }) {
  const [reste, setReste] = useState(PAUSE_SECONDES);
  const fin = useRef(onFini);
  const arret = useRef(onArreter);
  useEffect(() => {
    fin.current = onFini;
    arret.current = onArreter;
  });
  // Échap arrête le décompte d'où qu'il vienne, champ de recherche compris : écouté en capture, avant le
  // champ qui l'emploierait à se vider. Arrêter est le geste sûr.
  useEffect(() => {
    const surEchap = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      arret.current();
    };
    document.addEventListener('keydown', surEchap, true);
    return () => document.removeEventListener('keydown', surEchap, true);
  }, []);
  useEffect(() => {
    if (reste === 0) {
      fin.current();
      return;
    }
    const minuterie = setTimeout(() => setReste((r) => r - 1), 1000);
    return () => clearTimeout(minuterie);
  }, [reste]);
  return (
    <div className="grid gap-2">
      <p className="sr-only" role="status">
        Appel de {nom} dans {PAUSE_SECONDES} s.
      </p>
      <p role="timer" aria-live="off" className="text-lg text-balance">
        <span className="text-encre-3">Appel de </span>
        <span className="font-medium">{nom}</span>
        <span className="text-encre-3"> dans </span>
        <span className="font-mono text-encre">{reste}</span>
        <span className="text-encre-3"> s</span>
      </p>
      <Actions>
        <Action ton="fort" onClick={onFini}>
          Appeler maintenant
        </Action>
        <Action ton="discret" touche="Échap" raccourci="Escape" libelleRaccourci="Arrêter le décompte" onClick={onArreter}>
          Arrêter le décompte
        </Action>
      </Actions>
    </div>
  );
}
