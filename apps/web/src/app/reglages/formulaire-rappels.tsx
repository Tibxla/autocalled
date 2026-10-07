'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action, Champ, Message, Saisie } from '@/components/ui';
import type { ReglagesRappels } from '@/lib/reglages-rappels';
import { enregistrerRappelsAction, preparerRappelsAction } from './actions-rappels';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
type Valeur = Omit<ReglagesRappels, 'depuis'>;
const saisieDe = ({ actif, jours, debut, fin }: ReglagesRappels): Valeur => ({ actif, jours, debut, fin });

export function FormulaireRappels({ valeur, empreinte }: { valeur: ReglagesRappels; empreinte: string }) {
  const router = useRouter();
  const id = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const confirmation = useConfirmation();
  const [base, setBase] = useState({ valeur: saisieDe(valeur), empreinte });
  const [saisie, setSaisie] = useState(saisieDe(valeur));
  const [connue, setConnue] = useState(empreinte);
  const [lignes, setLignes] = useState<string[]>([]);
  const [retour, setRetour] = useState<{ alerte: boolean; texte: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, executer] = useTransition();
  if (base.empreinte !== empreinte) {
    setBase({ valeur: saisieDe(valeur), empreinte });
    if (JSON.stringify(saisie) === JSON.stringify(base.valeur)) {
      setSaisie(saisieDe(valeur));
      setConnue(empreinte);
    }
  }
  const change = JSON.stringify(saisie) !== JSON.stringify(saisieDe(valeur));
  const perime = connue !== empreinte;
  const bloque = occupe || confirmation.ouverte;
  const modifier = (v: Partial<Valeur>) => { setSaisie({ ...saisie, ...v }); setRetour(null); };
  const soumettre = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!change || bloque || perime) return;
    setRetour(null);
    setErreur(null);
    executer(async () => {
      const r = await preparerRappelsAction({ valeur: saisie, empreinte: connue });
      if (!r.ok) return setRetour({ alerte: true, texte: r.raison });
      setLignes(r.lignes);
      confirmation.ouvrir(bouton.current);
    });
  };
  const enregistrer = () => executer(async () => {
    const r = await enregistrerRappelsAction({ valeur: saisie, empreinte: connue });
    if (!r.ok) return setErreur(r.raison);
    setConnue(r.empreinte);
    confirmation.fermer();
    setRetour({ alerte: false, texte: 'Réglages enregistrés pour le prochain réveil.' });
    router.refresh();
  });

  return (
    <form onSubmit={soumettre} className="grid gap-5" aria-busy={occupe}>
      <label className="flex items-center gap-3 text-md pointer-coarse:min-h-11">
        <input type="checkbox" checked={saisie.actif} disabled={bloque} className="size-4 accent-[var(--encre)]" onChange={(e) => modifier({ actif: e.target.checked })} />
        Rappels convenus automatiques
      </label>
      <fieldset disabled={bloque} className="grid gap-2">
        <legend className="mb-2 text-sm text-encre-2">Jours autorisés</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {JOURS.map((jour, i) => <label key={jour} className="flex items-center gap-2 text-sm pointer-coarse:min-h-11"><input type="checkbox" className="size-4 accent-[var(--encre)]" checked={saisie.jours.includes(i + 1)} onChange={(e) => modifier({ jours: e.target.checked ? [...saisie.jours, i + 1].sort((a, b) => a - b) : saisie.jours.filter((j) => j !== i + 1) })} />{jour}</label>)}
        </div>
      </fieldset>
      <div className="grid max-w-sm grid-cols-2 gap-6">
        <Champ libelle="Début, heure de Paris" htmlFor={`${id}-debut`}><Saisie id={`${id}-debut`} type="time" step={60} required value={saisie.debut} disabled={bloque} onChange={(e) => modifier({ debut: e.target.value })} /></Champ>
        <Champ libelle="Fin, heure de Paris" htmlFor={`${id}-fin`}><Saisie id={`${id}-fin`} type="time" step={60} required value={saisie.fin} disabled={bloque} onChange={(e) => modifier({ fin: e.target.value })} /></Champ>
      </div>
      {perime ? <Message ton="alerte">Les réglages ont changé ailleurs. Ta saisie est conservée ; recharge les valeurs enregistrées.</Message> : null}
      {retour ? <Message ton={retour.alerte ? 'alerte' : 'neutre'}>{retour.texte}</Message> : null}
      <div className="-mx-1.5 flex flex-wrap gap-3 pointer-coarse:mx-0">
        <Action ref={bouton} type="submit" ton="fort" disabled={!change || bloque || perime} enCours={occupe} libelleEnCours="Vérification…">Enregistrer les rappels</Action>
        {(change || perime) && !bloque ? <Action ton="discret" onClick={() => { setSaisie(saisieDe(valeur)); setConnue(empreinte); setRetour(null); router.refresh(); }}>Recharger les valeurs enregistrées</Action> : null}
      </div>
      <Confirmation ouverte={confirmation.ouverte} question="Changer les prochains rappels ?" libelleConfirmer="Enregistrer" enCours={occupe} libelleEnCours="Enregistrement…" erreur={erreur} onAnnuler={confirmation.fermer} onConfirmer={enregistrer}>
        {lignes.map((ligne) => <p key={ligne}>{ligne}</p>)}
      </Confirmation>
    </form>
  );
}
