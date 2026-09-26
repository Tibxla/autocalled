'use client';

import { useActionState } from 'react';
import { Bouton, Champ, Message, Saisie, ZoneTexte } from '@/components/ui';
import { enregistrerObjection } from '../actions';

const TEMPS = [
  { nom: 'creuser', lettre: 'C', libelle: 'Creuser', aide: 'La question ouverte qui fait parler le prospect.' },
  { nom: 'reformuler', lettre: 'R', libelle: 'Reformuler', aide: 'Comment redire sa réserve avec ses mots.' },
  { nom: 'argumenter', lettre: 'A', libelle: 'Argumenter', aide: 'Une seule réponse, courte, appuyée sur ce qu’il a dit.' },
  { nom: 'controler', lettre: 'C', libelle: 'Contrôler', aide: 'La question qui vérifie que la réserve est levée.' },
] as const;

interface Objection {
  id: string;
  libelle: string;
  creuser: string;
  reformuler: string;
  argumenter: string;
  controler: string;
}

export function FormulaireObjection({ entrepriseId, objection }: { entrepriseId: string; objection?: Objection }) {
  const [etat, action, enCours] = useActionState(
    enregistrerObjection.bind(null, entrepriseId, objection?.id ?? null),
    null,
  );
  const e = etat?.erreurs ?? {};
  const prefixe = objection?.id ?? 'nouvelle';

  return (
    <form action={action} className="grid gap-6 pt-2 pb-8">
      <Champ libelle="L’objection, telle que le prospect la dit" htmlFor={`${prefixe}-libelle`} erreur={e.libelle}>
        <Saisie
          id={`${prefixe}-libelle`}
          name="libelle"
          defaultValue={objection?.libelle}
          placeholder="« On est déjà sur Booking »"
          required
          aria-invalid={e.libelle ? true : undefined}
        />
      </Champ>
      <ol className="grid gap-5">
        {TEMPS.map((t) => (
          <li key={t.nom} className="grid gap-x-4 sm:grid-cols-[1.75rem_1fr]">
            <span aria-hidden="true" className="hidden pt-px font-mono text-sm text-encre-3 sm:block">
              {t.lettre}
            </span>
            <Champ libelle={t.libelle} htmlFor={`${prefixe}-${t.nom}`} aide={t.aide} erreur={e[t.nom]}>
              <ZoneTexte id={`${prefixe}-${t.nom}`} name={t.nom} defaultValue={objection?.[t.nom]} />
            </Champ>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-4">
        <Bouton type="submit" disabled={enCours} variante={objection ? 'secondaire' : 'principal'}>
          {enCours ? 'Enregistrement…' : objection ? 'Enregistrer' : 'Ajouter l’objection'}
        </Bouton>
        {etat?.message ? <Message ton="neutre">{etat.message}</Message> : null}
      </div>
    </form>
  );
}
