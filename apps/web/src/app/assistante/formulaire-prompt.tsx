'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Action, Champ, Message, ZoneTexte } from '@/components/ui';
import { enregistrerPromptAction } from './actions';

export function FormulairePrompt({ prompt, empreinte }: { prompt: string; empreinte: string }) {
  const id = useId();
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);
  const [texte, setTexte] = useState(prompt);
  const [empreinteConnue, setEmpreinteConnue] = useState(empreinte);
  const [base, setBase] = useState({ prompt, empreinte });
  const [retour, setRetour] = useState<{ ton: 'neutre' | 'alerte'; texte: string; perime?: boolean } | null>(null);
  const [envoi, envoyer] = useTransition();
  const [rechargement, recharger] = useTransition();

  if (base.empreinte !== empreinte) {
    setBase({ prompt, empreinte });
    // Une saisie en cours garde aussi son empreinte : elle ne peut pas écraser une modification arrivée ailleurs.
    if (texte === base.prompt) {
      setTexte(prompt);
      setEmpreinteConnue(empreinte);
    }
  }
  const modifie = texte !== prompt;
  const perime = empreinteConnue !== empreinte;

  useRaccourci({
    touche: 'Enter', ctrl: true, dansChamp: true, libelle: 'Enregistrer le prompt', actif: modifie && !envoi,
    action: () => {
      if (!formulaire.current?.contains(document.activeElement)) return false;
      formulaire.current.requestSubmit();
    },
  });

  const soumettre = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!modifie || envoi) return;
    setRetour(null);
    envoyer(async () => {
      const r = await enregistrerPromptAction(texte, empreinteConnue);
      if (!r.ok) {
        setRetour({ ton: 'alerte', texte: r.raison, perime: r.raison.includes('recharge la page') });
        return;
      }
      setEmpreinteConnue(r.empreinteLocale);
      setRetour({ ton: 'neutre', texte: `Prompt enregistré. ${r.rappel}${r.avertissement ? ` ${r.avertissement}` : ''}` });
      router.refresh();
    });
  };

  const revenir = () => {
    setTexte(prompt);
    setEmpreinteConnue(empreinte);
    setRetour(null);
    router.refresh();
  };

  return (
    <form ref={formulaire} onSubmit={soumettre} className="grid min-w-0 gap-3" aria-busy={envoi}>
      <Champ libelle="Instructions de l’assistante" htmlFor={id} complement={<span className="font-mono text-sm text-encre-3">{texte.length.toLocaleString('fr-FR')} / 20 000</span>}>
        <ZoneTexte
          id={id} value={texte} rows={22} minLength={500} maxLength={20_000}
          disabled={envoi} spellCheck={false} soumissionClavier={false}
          onChange={(e) => { setTexte(e.target.value); setRetour(null); }}
          className="h-[min(65dvh,36rem)] max-h-[65dvh] font-mono text-sm leading-relaxed"
        />
      </Champ>
      {retour ? (
        <Message ton={retour.ton} action={retour.perime ? <Action enCours={rechargement} onClick={() => recharger(revenir)}>Recharger le prompt</Action> : undefined}>
          {retour.texte}
        </Message>
      ) : perime && modifie ? <Message ton="alerte">La configuration a changé depuis ta lecture. Ta saisie est conservée ; recharge le prompt avant d’enregistrer.</Message> : null}
      <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pointer-coarse:mx-0">
        <Action type="submit" ton="fort" touche="Ctrl Entrée" disabled={!modifie || envoi} enCours={envoi} libelleEnCours="Enregistrement…">Enregistrer le prompt</Action>
        {modifie ? <Action ton="discret" disabled={envoi} onClick={revenir}>Revenir au prompt enregistré</Action> : null}
        <a href="#poussee" className="px-1.5 py-1 text-sm underline underline-offset-4">Appliquer aux prochains appels</a>
      </div>
    </form>
  );
}
