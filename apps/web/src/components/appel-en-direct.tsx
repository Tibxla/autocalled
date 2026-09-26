'use client';

import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type DemarrageAppel, demarrerAppelNavigateur, terminerAppelNavigateur } from '@/app/appels/actions';
import { outilProposerCreneaux, outilReserverCreneau } from '@/app/appels/outils';
import { definirEtatLigne } from '@/lib/etat-ligne';
import { OndeDirect } from './onde-direct';
import { Bouton, Message, Saisie } from './ui';

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
  const [tours, setTours] = useState<{ role: 'agent' | 'prospect'; texte: string }[]>([]);
  const appelId = useRef<string | null>(null);
  const fil = useRef<HTMLOListElement>(null);

  const conclure = useCallback(async () => {
    definirEtatLigne('libre');
    const id = appelId.current;
    if (!id) return;
    appelId.current = null;
    setPhase('fin');
    await (clore ?? terminerAppelNavigateur)(id);
    if (onFin) onFin(id);
    else router.push(`/appels/${id}`);
  }, [clore, onFin, router]);

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
    const demarrage = ouvrir ? await ouvrir() : await demarrerAppelNavigateur(entrepriseId, prospectId, versionScriptId, campagneId);
    if (!demarrage.ok) {
      setPhase('repos');
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
        reserver_creneau: (parametres: { debut?: string; email?: string }) => outilReserverCreneau(id, parametres?.debut, parametres?.email),
      },
    });
  }, [campagneId, conversation, entrepriseId, ouvrir, prospectId, versionScriptId]);

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
      {phase === 'en-appel' ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const champ = e.currentTarget.elements.namedItem('reponse') as HTMLInputElement;
            const texte = champ.value.trim();
            if (!texte) return;
            conversation.sendUserMessage(texte);
            setTours((t) => [...t, { role: 'prospect', texte }]);
            champ.value = '';
          }}
        >
          <label htmlFor="reponse-ecrite" className="sr-only">
            Répondre par écrit
          </label>
          <Saisie id="reponse-ecrite" name="reponse" placeholder="Répondre par écrit (pièce bruyante, micro coupé…)" autoComplete="off" />
          <Bouton type="submit" variante="secondaire">
            Envoyer
          </Bouton>
        </form>
      ) : null}
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
