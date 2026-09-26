'use client';

import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { demarrerAppelNavigateur, terminerAppelNavigateur } from '@/app/appels/actions';
import { definirEtatLigne } from '@/lib/etat-ligne';
import { OndeDirect } from './onde-direct';
import { Bouton, Message } from './ui';

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
}

type Phase = 'repos' | 'connexion' | 'en-appel' | 'fin';

function Conversation({ entrepriseId, prospectId, prospectNom, versionScriptId, campagneId = null, onFin, demarrageAuto }: Proprietes) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('repos');
  const [erreur, setErreur] = useState<string | null>(null);
  const [tours, setTours] = useState<{ role: 'agent' | 'prospect'; texte: string }[]>([]);
  const appelId = useRef<string | null>(null);
  const fil = useRef<HTMLOListElement>(null);

  const conclure = useCallback(async () => {
    definirEtatLigne('libre');
    const id = appelId.current;
    if (!id) return;
    appelId.current = null;
    setPhase('fin');
    await terminerAppelNavigateur(id);
    if (onFin) onFin(id);
    else router.push(`/appels/${id}`);
  }, [onFin, router]);

  const conversation = useConversation({
    onConnect: () => {
      setPhase('en-appel');
      definirEtatLigne('en-appel');
    },
    onDisconnect: () => void conclure(),
    onMessage: (m) => {
      if (m.message.trim()) setTours((t) => [...t, { role: m.role === 'agent' ? 'agent' : 'prospect', texte: m.message }]);
    },
    onError: (message) => setErreur(typeof message === 'string' ? message : 'La connexion à Mina a échoué.'),
  });

  useEffect(() => {
    fil.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tours]);

  useEffect(() => () => definirEtatLigne('libre'), []);

  const demarrer = useCallback(async () => {
    setErreur(null);
    setTours([]);
    setPhase('connexion');
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase('repos');
      setErreur('Le navigateur n’a pas accès au micro : autorise-le pour jouer le prospect.');
      return;
    }
    const demarrage = await demarrerAppelNavigateur(entrepriseId, prospectId, versionScriptId, campagneId);
    if (!demarrage.ok) {
      setPhase('repos');
      setErreur(demarrage.raison);
      return;
    }
    appelId.current = demarrage.appelId;
    conversation.startSession({ conversationToken: demarrage.jeton, connectionType: 'webrtc', dynamicVariables: demarrage.variables });
  }, [campagneId, conversation, entrepriseId, prospectId, versionScriptId]);

  const lance = useRef(false);
  useEffect(() => {
    if (demarrageAuto && !lance.current) {
      lance.current = true;
      void demarrer();
    }
  }, [demarrageAuto, demarrer]);

  const entree = useCallback(() => conversation.getInputByteFrequencyData(), [conversation]);
  const sortie = useCallback(() => conversation.getOutputByteFrequencyData(), [conversation]);

  return (
    <div className="grid gap-4">
      <OndeDirect entree={entree} sortie={sortie} actif={phase === 'en-appel'} />
      <div className="flex flex-wrap items-center gap-3">
        {phase === 'en-appel' ? (
          <Bouton type="button" variante="secondaire" onClick={() => conversation.endSession()}>
            Raccrocher
          </Bouton>
        ) : (
          <Bouton type="button" disabled={phase !== 'repos'} onClick={() => void demarrer()}>
            {phase === 'connexion' ? 'Connexion…' : phase === 'fin' ? 'Appel terminé' : `Appeler ${prospectNom.split(' ')[0]}`}
          </Bouton>
        )}
        <span className="text-sm text-encre-3">
          {phase === 'en-appel'
            ? conversation.isSpeaking
              ? 'Mina parle'
              : 'Mina écoute'
            : phase === 'fin'
              ? 'Rapatriement de l’enregistrement et analyse…'
              : 'Ligne navigateur : tu joues le prospect au micro.'}
        </span>
      </div>
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
      {tours.length > 0 ? (
        <ol ref={fil} className="grid max-h-80 gap-2.5 overflow-y-auto border-t border-filet pt-4" aria-live="polite">
          {tours.map((t, i) => (
            <li key={i} className="grid gap-x-3 sm:grid-cols-[4.5rem_1fr]">
              <span className={`text-sm ${t.role === 'agent' ? 'text-antenne' : 'text-encre-3'}`}>{t.role === 'agent' ? 'Mina' : 'Prospect'}</span>
              <p className="max-w-[68ch]">{t.texte}</p>
            </li>
          ))}
        </ol>
      ) : null}
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
