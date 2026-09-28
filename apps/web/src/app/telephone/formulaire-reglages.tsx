'use client';

import { useActionState } from 'react';
import { Bouton, Message, Saisie } from '@/components/ui';
import type { ReglagesLigne } from '@/lib/pont';
import { enregistrerReglages } from './actions';

const CHAMPS: { nom: keyof ReglagesLigne; libelle: string; aide: string; min: number; max: number; unite: string }[] = [
  { nom: 'appelsParHeure', libelle: 'Appels par heure', aide: 'Au-delà, le pont refuse de composer.', min: 1, max: 60, unite: 'appels' },
  { nom: 'appelsParJour', libelle: 'Appels par jour', aide: 'Sur les dernières 24 heures glissantes.', min: 1, max: 500, unite: 'appels' },
  { nom: 'pauseEntreAppelsS', libelle: 'Pause entre deux appels', aide: 'Dans une campagne, après la fin d’un appel.', min: 5, max: 600, unite: 's' },
];

export function FormulaireReglages({ reglages }: { reglages: ReglagesLigne }) {
  const [etat, envoyer, enCours] = useActionState(enregistrerReglages, { message: null, ok: false });
  return (
    <form action={envoyer} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {CHAMPS.map((c) => (
          <div key={c.nom} className="grid content-start gap-1.5">
            <label htmlFor={c.nom} className="text-sm font-medium">
              {c.libelle}
            </label>
            <div className="flex items-center gap-2">
              <Saisie id={c.nom} name={c.nom} type="number" min={c.min} max={c.max} step={1} defaultValue={reglages[c.nom]} className="w-24 font-mono" required />
              <span className="text-sm text-encre-3">{c.unite}</span>
            </div>
            <p className="text-sm text-encre-3">{c.aide}</p>
          </div>
        ))}
      </div>
      {etat.message ? <Message ton={etat.ok ? 'neutre' : 'alerte'}>{etat.message}</Message> : null}
      <Bouton type="submit" variante="secondaire" className="justify-self-start" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer'}
      </Bouton>
    </form>
  );
}
