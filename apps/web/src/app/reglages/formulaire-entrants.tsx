'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { Action, Champ, Message, Saisie } from '@/components/ui';
import { enregistrerEntrantsAction, preparerEntrantsAction } from './actions-entrants';

type Valeur = { actif: boolean; accueil: string };

export function FormulaireEntrants({ valeur, empreinte, nom }: { valeur: Valeur; empreinte: string; nom: string }) {
  const id = useId();
  const router = useRouter();
  const bouton = useRef<HTMLButtonElement>(null);
  const confirmation = useConfirmation();
  const [base, setBase] = useState({ valeur, empreinte });
  const [saisie, setSaisie] = useState(valeur);
  const [connue, setConnue] = useState(empreinte);
  const [lignes, setLignes] = useState<string[]>([]);
  const [retour, setRetour] = useState<{ alerte: boolean; texte: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, executer] = useTransition();
  if (base.empreinte !== empreinte) {
    setBase({ valeur, empreinte });
    if (saisie.actif === base.valeur.actif && saisie.accueil === base.valeur.accueil) {
      setSaisie(valeur);
      setConnue(empreinte);
    }
  }
  const change = saisie.actif !== valeur.actif || saisie.accueil.trim() !== valeur.accueil;
  const perime = connue !== empreinte;
  const bloquee = occupe || confirmation.ouverte;
  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!change || bloquee) return;
    setRetour(null);
    setErreur(null);
    executer(async () => {
      const r = await preparerEntrantsAction({ valeur: saisie, empreinte: connue });
      if (!r.ok) return setRetour({ alerte: true, texte: r.raison });
      setLignes(r.lignes);
      confirmation.ouvrir(bouton.current);
    });
  };
  const enregistrer = () => executer(async () => {
    const r = await enregistrerEntrantsAction({ valeur: saisie, empreinte: connue });
    if (!r.ok) return setErreur(r.raison);
    setConnue(r.empreinte);
    confirmation.fermer();
    setRetour({ alerte: false, texte: 'Enregistré pour le prochain appel entrant.' });
    router.refresh();
  });

  return (
    <form className="grid gap-5" onSubmit={envoyer} aria-busy={occupe}>
      <label className="flex items-center gap-3 text-md pointer-coarse:min-h-11">
        <input type="checkbox" checked={saisie.actif} disabled={bloquee} className="size-4 accent-[var(--encre)]" onChange={(e) => { setSaisie({ ...saisie, actif: e.target.checked }); setRetour(null); }} />
        {nom} décroche automatiquement
      </label>
      <Champ libelle="Accueil entrant" htmlFor={`${id}-accueil`} aide="Dit dès qu’elle décroche. {{assistante_nom}} est remplacé par son nom ; 160 caractères au plus.">
        <Saisie id={`${id}-accueil`} value={saisie.accueil} maxLength={160} required autoComplete="off" disabled={bloquee} onChange={(e) => { setSaisie({ ...saisie, accueil: e.target.value }); setRetour(null); }} />
      </Champ>
      {perime ? <Message ton="alerte">Les réglages ont changé ailleurs. Ta saisie est conservée ; recharge les valeurs enregistrées avant de les remplacer.</Message> : null}
      {retour ? <Message ton={retour.alerte ? 'alerte' : 'neutre'}>{retour.texte}</Message> : null}
      <div className="-mx-1.5 flex flex-wrap gap-3 pointer-coarse:mx-0">
        <Action ref={bouton} type="submit" ton="fort" disabled={!change || bloquee || perime} enCours={occupe} libelleEnCours="Vérification…">Enregistrer les appels entrants</Action>
        {(change || perime) && !bloquee ? <Action ton="discret" onClick={() => { setSaisie(valeur); setConnue(empreinte); setRetour(null); router.refresh(); }}>Recharger les valeurs enregistrées</Action> : null}
      </div>
      <Confirmation ouverte={confirmation.ouverte} question="Changer les prochains appels entrants ?" libelleConfirmer="Enregistrer" enCours={occupe} libelleEnCours="Enregistrement…" erreur={erreur} onAnnuler={confirmation.fermer} onConfirmer={enregistrer}>
        {lignes.map((ligne) => <p key={ligne} className="break-words">{ligne}</p>)}
      </Confirmation>
    </form>
  );
}
