'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Prise de main (ADR 0008) : WebSocket direct vers le pont, par le chemin `/prise-en-main` de `tailscale serve`.
 * Le micro part en PCM 16 bits à 16 kHz par blocs de 20 ms ; le prospect revient au taux de la ligne, lu avec
 * un tampon court. Le contexte audio tourne à 16 kHz : le navigateur rééchantillonne lui-même le micro.
 */

const TAUX_MICRO = 16000;
const BLOC_MICRO = TAUX_MICRO / 50; // 20 ms
const TAMPON_LECTURE_S = 0.12;

// Capture brute dans un AudioWorklet, chargé depuis un Blob : rien à servir à part.
const CAPTURE = `
class Capture extends AudioWorkletProcessor {
  process(entrees) {
    const canal = entrees[0] && entrees[0][0];
    if (canal) this.port.postMessage(canal.slice(0));
    return true;
  }
}
registerProcessor('capture-operateur', Capture);
`;

export type EtatPrise = 'repos' | 'connexion' | 'active' | 'erreur';

export function usePriseDeMain(appelId: string) {
  const [etat, setEtat] = useState<EtatPrise>('repos');
  const [erreur, setErreur] = useState<string | null>(null);
  const [muet, setMuet] = useState(false);
  const muetRef = useRef(false);
  const arret = useRef<(() => void) | null>(null);

  const arreter = useCallback(() => {
    arret.current?.();
    arret.current = null;
  }, []);

  const demarrer = useCallback(async () => {
    setErreur(null);
    setEtat('connexion');
    let micro: MediaStream;
    try {
      micro = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setEtat('erreur');
      setErreur('Le navigateur n’a pas accès au micro : autorise-le pour parler au prospect.');
      return;
    }
    let contexte: AudioContext;
    let capture: AudioWorkletNode;
    let ws: WebSocket;
    try {
      contexte = new AudioContext({ sampleRate: TAUX_MICRO });
      const url = URL.createObjectURL(new Blob([CAPTURE], { type: 'text/javascript' }));
      await contexte.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = contexte.createMediaStreamSource(micro);
      capture = new AudioWorkletNode(contexte, 'capture-operateur');
      const silence = contexte.createGain();
      silence.gain.value = 0; // le nœud doit être relié à la sortie pour tourner, sans qu'on s'entende soi-même
      source.connect(capture).connect(silence).connect(contexte.destination);
      ws = new WebSocket(`wss://${location.host}/prise-en-main/appels/${appelId}`);
    } catch {
      micro.getTracks().forEach((t) => t.stop());
      setEtat('erreur');
      setErreur('Impossible de préparer le son pour la prise de main (navigateur, ou page ouverte hors du tailnet).');
      return;
    }
    ws.binaryType = 'arraybuffer';
    let tauxProspect = TAUX_MICRO;
    let prochain = 0;
    let bloc = new Float32Array(0);

    capture.port.onmessage = (m: MessageEvent<Float32Array>) => {
      const suite = new Float32Array(bloc.length + m.data.length);
      suite.set(bloc);
      suite.set(m.data, bloc.length);
      bloc = suite;
      while (bloc.length >= BLOC_MICRO) {
        const tranche = bloc.subarray(0, BLOC_MICRO);
        bloc = bloc.slice(BLOC_MICRO);
        if (ws.readyState !== WebSocket.OPEN) continue;
        const pcm = new Int16Array(BLOC_MICRO);
        if (!muetRef.current) for (let i = 0; i < BLOC_MICRO; i++) pcm[i] = Math.max(-32768, Math.min(32767, tranche[i]! * 32768));
        ws.send(pcm.buffer);
      }
    };

    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        tauxProspect = (JSON.parse(m.data) as { taux?: number }).taux ?? TAUX_MICRO;
        setEtat('active');
        return;
      }
      const pcm = new Int16Array(m.data as ArrayBuffer);
      const tampon = contexte.createBuffer(1, pcm.length, tauxProspect);
      const canal = tampon.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i]! / 32768;
      const lecture = contexte.createBufferSource();
      lecture.buffer = tampon;
      lecture.connect(contexte.destination);
      prochain = Math.max(prochain, contexte.currentTime + TAMPON_LECTURE_S);
      lecture.start(prochain);
      prochain += tampon.duration;
    };

    ws.onclose = (e) => {
      arret.current?.();
      arret.current = null;
      if (e.code === 4404 || e.code === 1000) setEtat('repos');
      else {
        setEtat('erreur');
        setErreur(e.reason || 'La liaison avec le pont s’est coupée. Tu peux reprendre la main à nouveau tant que l’appel dure.');
      }
    };

    arret.current = () => {
      ws.onclose = null;
      ws.close();
      micro.getTracks().forEach((t) => t.stop());
      void contexte.close();
      setEtat('repos');
    };
  }, [appelId]);

  const basculerMuet = useCallback(() => {
    muetRef.current = !muetRef.current;
    setMuet(muetRef.current);
  }, []);

  useEffect(() => () => arret.current?.(), []);
  return { etat, erreur, muet, demarrer, arreter, basculerMuet };
}
