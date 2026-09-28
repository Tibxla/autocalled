'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { raccrocherAppelTelephone } from '@/app/appels/actions';
import { Bouton, Message } from '@/components/ui';
import { BoutonRelancer } from './bouton-relancer';
import { definirEtatLigne } from '@/lib/etat-ligne';

type Tour = { role: 'agent' | 'prospect'; texte: string };

const LIBELLES: Record<string, string> = {
  composition: 'Composition…',
  dialing: 'Composition…',
  alerting: 'Ça sonne',
  active: 'En ligne',
  reconnexion: 'Canal son absent : reconnexion du téléphone et nouvelle tentative',
  disconnected: 'Raccroché',
  termine: 'Appel terminé, rapatriement et analyse…',
};

/** Retard ajouté à l'écoute pour absorber les à-coups du réseau (en secondes). */
const TAMPON_ECOUTE = 0.4;

/**
 * Écoute en direct : lit le flux PCM relayé par l'application et le programme dans WebAudio par
 * morceaux de 100 ms. Une à deux secondes de retard sur l'appel.
 */
function useEcoute(appelId: string) {
  const [active, setActive] = useState(false);
  const arret = useRef<(() => void) | null>(null);

  const arreter = useCallback(() => {
    arret.current?.();
    arret.current = null;
    setActive(false);
  }, []);

  const demarrer = useCallback(async () => {
    const controleur = new AbortController();
    const contexte = new AudioContext();
    arret.current = () => {
      controleur.abort();
      void contexte.close();
    };
    setActive(true);
    try {
      const r = await fetch(`/appels/${appelId}/ecoute`, { signal: controleur.signal, cache: 'no-store' });
      if (!r.ok || !r.body) throw new Error();
      const taux = Number(r.headers.get('x-taux')) || 16000;
      const lecteur = r.body.getReader();
      const parMorceau = Math.round(taux / 10);
      let reste = new Uint8Array(0);
      let echantillons: number[] = [];
      let prochain = 0;
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        const octets = new Uint8Array(reste.length + value.length);
        octets.set(reste);
        octets.set(value, reste.length);
        const pairs = octets.length - (octets.length % 2);
        const vue = new DataView(octets.buffer, 0, pairs);
        for (let i = 0; i < pairs; i += 2) echantillons.push(vue.getInt16(i, true) / 32768);
        reste = octets.slice(pairs);
        while (echantillons.length >= parMorceau) {
          const morceau = echantillons.slice(0, parMorceau);
          echantillons = echantillons.slice(parMorceau);
          const tampon = contexte.createBuffer(1, morceau.length, taux);
          tampon.copyToChannel(Float32Array.from(morceau), 0);
          const source = contexte.createBufferSource();
          source.buffer = tampon;
          source.connect(contexte.destination);
          prochain = Math.max(prochain, contexte.currentTime + TAMPON_ECOUTE);
          source.start(prochain);
          prochain += tampon.duration;
        }
      }
    } catch {
      // arrêt demandé, ou appel terminé
    }
    arreter();
  }, [appelId, arreter]);

  useEffect(() => () => arret.current?.(), []);
  return { active, demarrer, arreter };
}

export function SuiviTelephone({ appelId }: { appelId: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState('composition');
  const [tours, setTours] = useState<Tour[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [raccrochage, setRaccrochage] = useState(false);
  const [perdu, setPerdu] = useState(false);
  const fil = useRef<HTMLOListElement>(null);
  const ecoute = useEcoute(appelId);

  useEffect(() => {
    const source = new EventSource(`/appels/${appelId}/direct`);
    source.onmessage = (m) => {
      const e = JSON.parse(m.data) as { type: string; etat?: string; role?: Tour['role']; texte?: string };
      if (e.type === 'etat' && e.etat) {
        setEtat(e.etat);
        definirEtatLigne(e.etat === 'termine' || e.etat === 'disconnected' ? 'libre' : 'en-appel');
        if (e.etat === 'termine') {
          source.close();
          router.refresh();
        }
      } else if (e.type === 'tour' && e.role && e.texte?.trim()) {
        setTours((t) => [...t, { role: e.role!, texte: e.texte! }]);
      }
    };
    // Coupure passagère : EventSource se reconnecte seul et reprend après le dernier événement reçu.
    // Refus définitif (le pont ne connaît plus l'appel, terminé entre-temps) : la page affichera le bilan.
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return;
      definirEtatLigne('libre');
      setPerdu(true);
      router.refresh();
    };
    return () => {
      source.close();
      definirEtatLigne('libre');
    };
  }, [appelId, router]);

  useEffect(() => {
    fil.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tours]);

  const enLigne = etat !== 'termine' && etat !== 'disconnected';

  // Le pont ne connaît pas (ou plus) cet appel alors qu'il est toujours « en cours » ici : la fin ne nous est
  // jamais parvenue (pont redémarré pendant l'appel, par exemple). On propose de rapatrier la conversation.
  if (perdu) {
    return (
      <div className="grid justify-items-start gap-3">
        <Message ton="neutre">
          Le pont ne suit plus cet appel : il a sans doute été coupé (pont redémarré pendant l’appel). Tu peux rapatrier ce qu’ElevenLabs
          en a gardé.
        </Message>
        <BoutonRelancer appelId={appelId} libelle="Récupérer l’appel" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-sm font-medium ${etat === 'active' ? 'text-antenne' : 'text-encre-2'}`} role="status">
          {LIBELLES[etat] ?? etat}
        </span>
        {enLigne ? (
          <>
            <Bouton
              type="button"
              variante="secondaire"
              disabled={raccrochage}
              onClick={async () => {
                setRaccrochage(true);
                const r = await raccrocherAppelTelephone(appelId);
                if (!r.ok) {
                  setErreur(r.raison);
                  setRaccrochage(false);
                }
              }}
            >
              {raccrochage ? 'Raccrochage…' : 'Raccrocher'}
            </Bouton>
            <Bouton type="button" variante="discret" onClick={() => (ecoute.active ? ecoute.arreter() : void ecoute.demarrer())}>
              {ecoute.active ? 'Arrêter l’écoute' : 'Écouter'}
            </Bouton>
          </>
        ) : null}
      </div>
      {ecoute.active ? <p className="text-sm text-encre-3">Écoute en direct, une à deux secondes de retard. Personne ne t’entend.</p> : null}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
      {tours.length > 0 ? (
        <ol ref={fil} className="grid max-h-96 gap-2.5 overflow-y-auto border-t border-filet pt-4" aria-live="polite">
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
