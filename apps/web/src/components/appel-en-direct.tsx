'use client';

import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type DemarrageAppel, demarrerAppelNavigateur, terminerAppelNavigateur } from '@/app/appels/actions';
import { outilProposerCreneaux, outilReserverCreneau } from '@/app/appels/outils';
import { definirEtatLigne } from '@/lib/etat-ligne';
import { Action } from './action';
import { type TourDirect, VueBandeAppel } from './bande-appel';
import { Saisie } from './champs';
import { prenom } from './format-appel';
import { OndeDirect } from './onde-direct';

interface Proprietes {
  entrepriseId: string;
  prospectId: string;
  prospectNom: string;
  versionScriptId: string;
  campagneId?: string | null;
  /** Appelé quand l'appel est fini ; par défaut, on ouvre la page de l'appel. */
  onFin?: (appelId: string) => void;
  /** Démarre dès l'affichage (enchaînement d'une campagne). */
  demarrageAuto?: boolean;
  /** Remplace l'ouverture et la clôture par défaut (une campagne passe par sa propre machine à états). */
  ouvrir?: () => Promise<DemarrageAppel>;
  clore?: (appelId: string) => Promise<void>;
}

type Phase = 'repos' | 'connexion' | 'en-appel' | 'fin';

const rien = () => {};
const ERREUR_CONNEXION = 'La connexion à Mina a échoué. Réessaie ; si ça recommence, vérifie la connexion réseau.';

/**
 * Ligne navigateur : l'opérateur joue le prospect au micro. Même bande que la ligne téléphone (sous-titre de
 * Mina, fil sous T), avec ses propres gestes : rien ne sonne, donc ni confirmation pour appeler ni pour
 * raccrocher. L'onde vient des deux flux audio réels de la conversation.
 */
function Conversation({
  entrepriseId,
  prospectId,
  prospectNom,
  versionScriptId,
  campagneId = null,
  onFin,
  demarrageAuto,
  ouvrir,
  clore,
}: Proprietes) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('repos');
  const [erreur, setErreur] = useState<string | null>(null);
  const [tours, setTours] = useState<TourDirect[]>([]);
  const [enLigneDepuis, setEnLigneDepuis] = useState<number | null>(null);
  const [finLe, setFinLe] = useState(0);
  const appelId = useRef<string | null>(null);
  const phaseCourante = useRef<Phase>('repos');
  const idReponse = useId();

  const changerPhase = useCallback((suivante: Phase) => {
    phaseCourante.current = suivante;
    setPhase(suivante);
  }, []);

  const conclure = useCallback(async () => {
    definirEtatLigne('libre');
    const id = appelId.current;
    if (!id) return;
    appelId.current = null;
    setFinLe(Date.now());
    changerPhase('fin');
    await (clore ?? terminerAppelNavigateur)(id);
    if (onFin) onFin(id);
    else router.push(`/appels/${id}`);
  }, [changerPhase, clore, onFin, router]);

  /** Connexion ratée : retour au repos avec le message ; un appel déjà enregistré est clos, pas laissé « en cours ». */
  const abandonner = useCallback(
    (message: string) => {
      definirEtatLigne('libre');
      setErreur(message);
      changerPhase('repos');
      const id = appelId.current;
      appelId.current = null;
      if (!id) return;
      void (clore ?? terminerAppelNavigateur)(id)
        .then(() => onFin?.(id))
        .catch(() => undefined);
    },
    [changerPhase, clore, onFin],
  );

  const conversation = useConversation({
    onConnect: () => {
      changerPhase('en-appel');
      setEnLigneDepuis(Date.now());
      definirEtatLigne('en-appel');
    },
    onDisconnect: () => void conclure(),
    onMessage: (m) => {
      if (!m.message.trim()) return;
      const tour: TourDirect = { role: m.role === 'agent' ? 'agent' : 'prospect', texte: m.message, recuLe: Date.now() };
      setTours((t) => [...t, tour]);
    },
    onError: (message) => {
      const texte = typeof message === 'string' && message.trim() ? `La connexion à Mina a échoué : ${message}` : ERREUR_CONNEXION;
      if (phaseCourante.current === 'connexion') abandonner(texte);
      else setErreur(texte);
    },
  });

  useEffect(() => () => definirEtatLigne('libre'), []);

  const demarrer = useCallback(async () => {
    setErreur(null);
    setTours([]);
    setEnLigneDepuis(null);
    changerPhase('connexion');
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      changerPhase('repos');
      setErreur('Le navigateur n’a pas accès au micro : autorise-le pour jouer le prospect.');
      return;
    }
    let demarrage: DemarrageAppel;
    try {
      demarrage = ouvrir ? await ouvrir() : await demarrerAppelNavigateur(entrepriseId, prospectId, versionScriptId, campagneId);
    } catch {
      abandonner('L’appel n’a pas pu être enregistré : le serveur n’a pas répondu.');
      return;
    }
    if (!demarrage.ok) {
      changerPhase('repos');
      setErreur(demarrage.raison);
      return;
    }
    appelId.current = demarrage.appelId;
    const id = demarrage.appelId;
    conversation.startSession({
      conversationToken: demarrage.jeton,
      connectionType: 'webrtc',
      dynamicVariables: demarrage.variables,
      overrides: { asr: { keywords: demarrage.motsCles } },
      clientTools: {
        proposer_creneaux: () => outilProposerCreneaux(id),
        reserver_creneau: (parametres: { debut?: string; email?: string; adresse_confirmee?: boolean }) =>
          outilReserverCreneau(id, parametres?.debut, parametres?.email, parametres?.adresse_confirmee),
      },
    });
  }, [abandonner, campagneId, changerPhase, conversation, entrepriseId, ouvrir, prospectId, versionScriptId]);

  const lance = useRef(false);
  useEffect(() => {
    if (demarrageAuto && !lance.current) {
      lance.current = true;
      void demarrer();
    }
  }, [demarrageAuto, demarrer]);

  const entree = useCallback(() => conversation.getInputByteFrequencyData(), [conversation]);
  const sortie = useCallback(() => conversation.getOutputByteFrequencyData(), [conversation]);

  const alerte = erreur ? (
    <p role="alert" className="rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
      {erreur}
    </p>
  ) : null;

  if (phase === 'repos') {
    return (
      <div className="grid justify-items-start gap-3">
        <div className="-mx-1.5">
          {/* Pas de raccourci : l'appel est enregistré en base dès le clic (règle du clavier). */}
          <Action ton="fort" onClick={() => void demarrer()}>
            Appeler {prenom(prospectNom)} au micro
          </Action>
        </div>
        {alerte}
      </div>
    );
  }

  const actions =
    phase === 'en-appel' ? (
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="px-1.5 text-sm text-encre-3">{conversation.isSpeaking ? 'Mina parle' : 'Mina écoute'}</span>
        <Action ton="alerte" onClick={() => conversation.endSession()}>
          Raccrocher
        </Action>
      </div>
    ) : (
      <></>
    );

  return (
    <div className="grid gap-4">
      <VueBandeAppel
        variante="bande"
        etat={phase === 'connexion' ? 'Connexion à Mina…' : phase === 'fin' ? 'termine' : 'active'}
        perdu={false}
        tours={tours}
        chrono={phase === 'en-appel' && enLigneDepuis ? { libelle: 'en ligne', depuis: enLigneDepuis } : null}
        ecoute={{ active: false, erreur: null }}
        prise={{ etat: 'repos', erreur: null, muet: false }}
        raccrochage={{ enCours: false, erreur: null }}
        termine={phase === 'fin' ? { le: finLe } : null}
        actions={actions}
        onde={phase === 'fin' ? <></> : <OndeDirect entree={entree} sortie={sortie} actif={phase === 'en-appel'} />}
        libelleProspect="Toi (prospect)"
        onEcouter={rien}
        onArreterEcoute={rien}
        onPrendreLaMain={rien}
        onBasculerMicro={rien}
        onRaccrocher={rien}
      />
      {phase === 'en-appel' ? (
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const champ = e.currentTarget.elements.namedItem('reponse') as HTMLInputElement;
            const texte = champ.value.trim();
            if (!texte) return;
            conversation.sendUserMessage(texte);
            setTours((t) => [...t, { role: 'prospect', texte, recuLe: Date.now() }]);
            champ.value = '';
          }}
        >
          <label htmlFor={idReponse} className="sr-only">
            Répondre par écrit
          </label>
          <div className="min-w-0 flex-1">
            <Saisie id={idReponse} name="reponse" placeholder="Répondre par écrit (pièce bruyante, micro coupé…)" autoComplete="off" />
          </div>
          <Action type="submit" className="-mr-1.5">
            Envoyer
          </Action>
        </form>
      ) : null}
      {alerte}
    </div>
  );
}

export function AppelEnDirect(proprietes: Proprietes) {
  return (
    <ConversationProvider>
      <Conversation {...proprietes} />
    </ConversationProvider>
  );
}
