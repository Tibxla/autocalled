'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Action, Champ, Message, Saisie, Selection } from '@/components/ui';
import type { CatalogueAssistante, ChoixAssistante } from '@/lib/catalogue-assistante';

export function useCatalogueAssistante() {
  const [catalogue, setCatalogue] = useState<CatalogueAssistante | null>(null);
  useEffect(() => {
    const annulation = new AbortController();
    fetch('/api/assistante/catalogue', { signal: annulation.signal, cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(); setCatalogue(await r.json() as CatalogueAssistante); })
      .catch(() => { if (!annulation.signal.aborted) setCatalogue({ voix: [], modelesVoix: [], modelesLangage: [], indisponibles: ['Voix', 'Modèles de voix', 'Modèles de langage'] }); });
    return () => annulation.abort();
  }, []);
  return catalogue;
}

export function ChoixCatalogue({ id, libelle, valeur, choix, desactive, erreur, modifie, onChange }: {
  id: string; libelle: string; valeur: string; choix: ChoixAssistante[]; desactive: boolean; erreur?: string; modifie: boolean; onChange: (texte: string) => void;
}) {
  const [personnalise, setPersonnalise] = useState(false);
  const trouve = choix.some((c) => c.id === valeur);
  return (
    <Champ htmlFor={id} libelle={libelle} erreur={erreur} complement={modifie ? <span className="text-sm text-encre-3">modifié</span> : null}>
      <div className="grid min-w-0 gap-2" aria-invalid={false}>
        <Selection id={personnalise ? `${id}-choix` : id} aria-label={personnalise ? `${libelle} : catalogue` : undefined} value={personnalise ? '__personnalise__' : valeur} disabled={desactive} aria-invalid={!personnalise && erreur ? true : undefined} aria-describedby={erreur ? `${id}-erreur` : undefined}
          onChange={(e) => { if (e.target.value === '__personnalise__') setPersonnalise(true); else { setPersonnalise(false); onChange(e.target.value); } }}>
          {!trouve && !personnalise ? <option value={valeur}>{valeur || 'Non défini'}{valeur ? ' · valeur actuelle' : ''}</option> : null}
          {choix.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          <option value="__personnalise__">Saisir un identifiant…</option>
        </Selection>
        {personnalise ? <Saisie id={id} value={valeur} maxLength={60} autoComplete="off" spellCheck={false} disabled={desactive} onChange={(e) => onChange(e.target.value)} className="font-mono" aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${id}-erreur` : undefined} /> : null}
      </div>
    </Champ>
  );
}

export function ApercuVoix({ valeurs, desactive }: { valeurs: Record<string, string>; desactive: boolean }) {
  const [generation, generer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [apercu, setApercu] = useState<{ url: string; choix: string } | null>(null);
  const derniereUrl = useRef<string | null>(null);
  const requete = useRef<AbortController | null>(null);
  const saisie = { voiceId: valeurs['voix.voiceId'], modele: valeurs['voix.modele'], stabilite: Number(valeurs['voix.stabilite']), similarite: Number(valeurs['voix.similarite']), vitesse: Number(valeurs['voix.vitesse']) };
  const choix = JSON.stringify(saisie);
  useEffect(() => () => {
    requete.current?.abort();
    if (derniereUrl.current) URL.revokeObjectURL(derniereUrl.current);
  }, []);
  const ecouter = () => {
    setErreur(null);
    generer(async () => {
      const annulation = new AbortController();
      requete.current = annulation;
      try {
        const r = await fetch('/api/assistante/apercu', { method: 'POST', headers: { 'content-type': 'application/json' }, body: choix, signal: annulation.signal });
        if (!r.ok) { const retour = await r.json() as { raison?: string }; throw new Error(retour.raison ?? 'Aperçu indisponible.'); }
        const audio = await r.blob();
        if (annulation.signal.aborted) return;
        if (derniereUrl.current) URL.revokeObjectURL(derniereUrl.current);
        derniereUrl.current = URL.createObjectURL(audio);
        setApercu({ url: derniereUrl.current, choix });
      } catch (e) {
        if (!annulation.signal.aborted) setErreur(e instanceof Error ? e.message : 'Aperçu indisponible.');
      }
    });
  };
  return <div className="grid min-w-0 gap-3">
    <div><Action type="button" disabled={desactive || generation} enCours={generation} libelleEnCours="Préparation de l’aperçu…" onClick={ecouter}>{apercu?.choix === choix ? 'Générer un nouvel extrait' : 'Écouter la voix choisie'}</Action></div>
    <p className="text-sm text-encre-3">Court extrait neutre avec la voix et le modèle choisis. Chaque nouvel extrait utilise les crédits ElevenLabs.</p>
    {apercu?.choix === choix ? <audio key={apercu.url} src={apercu.url} controls autoPlay className="w-full max-w-md" aria-label="Aperçu de la voix choisie" /> : null}
    {erreur ? <Message ton="alerte">{erreur}</Message> : null}
  </div>;
}
