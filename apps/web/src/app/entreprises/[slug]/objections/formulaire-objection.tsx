'use client';

import { useEffect, useRef } from 'react';
import { useRaccourci } from '@/components/clavier';
import { ChampConnu, MessageConflit, useRechargement } from '@/components/conflit';
import { Action, Champ, Message, Saisie, ZoneTexte } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import type { EtatFormulaire } from '@/lib/formulaire';
import { enregistrerObjection } from '../actions';

export const TEMPS = [
  { nom: 'creuser', lettre: 'C', libelle: 'Creuser', verbe: 'creuser', aide: 'La question ouverte qui fait parler le prospect.' },
  { nom: 'reformuler', lettre: 'R', libelle: 'Reformuler', verbe: 'reformuler', aide: 'Comment redire sa réserve avec ses mots.' },
  { nom: 'argumenter', lettre: 'A', libelle: 'Argumenter', verbe: 'argumenter', aide: 'Une seule réponse, courte, appuyée sur ce qu’il a dit.' },
  { nom: 'controler', lettre: 'C', libelle: 'Contrôler', verbe: 'contrôler', aide: 'La question qui vérifie que la réserve est levée.' },
] as const;

export interface Objection {
  id: string;
  libelle: string;
  creuser: string;
  reformuler: string;
  argumenter: string;
  controler: string;
  /** Horodatage de la dernière modification (ISO), renvoyé pour la garde de concurrence. */
  modifieLe: string;
}

/**
 * Une objection et ses quatre temps (CRAC). Saisie gardée après un refus (useFormulaire), Ctrl+Entrée depuis
 * une zone de texte enregistre. `archive` se place à l'autre bout de la rangée d'actions ; `onAnnuler` (nouvelle
 * objection) ajoute « Échap Annuler ».
 */
type Proprietes = {
  entrepriseId: string;
  objection?: Objection;
  onSucces?: (message: string) => void;
  onAnnuler?: () => void;
  archive?: React.ReactNode;
};

/** « Recharger », après un refus pour modification concurrente, remonte le formulaire avec l'objection relue. */
export function FormulaireObjection(proprietes: Proprietes) {
  const { cle, recharger, enCours } = useRechargement();
  return <Formulaire key={cle} {...proprietes} recharger={recharger} rechargement={enCours} />;
}

function Formulaire({
  entrepriseId,
  objection,
  onSucces,
  onAnnuler,
  archive,
  recharger,
  rechargement,
}: Proprietes & { recharger: () => void; rechargement: boolean }) {
  const { etat, enCours, modifie, proprietes } = useFormulaire<EtatFormulaire>(
    enregistrerObjection.bind(null, entrepriseId, objection?.id ?? null),
    null,
  );
  const e = etat?.erreurs ?? {};
  const prefixe = objection?.id ?? 'nouvelle';
  const nouvelle = !objection;

  // Succès : le parent referme la nouvelle objection ou annonce l'enregistrement.
  const signale = useRef(etat);
  useEffect(() => {
    if (signale.current === etat) return;
    signale.current = etat;
    if (etat?.ok) onSucces?.(etat.message ?? 'Objection enregistrée.');
  }, [etat, onSucces]);

  useRaccourci({
    touche: 'Escape',
    libelle: 'Annuler la nouvelle objection',
    dansChamp: true,
    actif: Boolean(onAnnuler) && !enCours,
    action: () => {
      if (!proprietes.ref.current?.contains(document.activeElement)) return false;
      onAnnuler?.();
    },
  });

  return (
    <form {...proprietes} aria-label={nouvelle ? 'Nouvelle objection' : `Objection « ${objection.libelle} »`} className="grid gap-5 pt-2 pb-6">
      {objection ? <ChampConnu valeur={objection.modifieLe} /> : null}
      <Champ libelle="L’objection, telle que le prospect la dit" htmlFor={`${prefixe}-libelle`} erreur={e.libelle}>
        <Saisie
          id={`${prefixe}-libelle`}
          name="libelle"
          defaultValue={objection?.libelle}
          placeholder="« On est déjà sur Booking »"
          required
          maxLength={160}
          autoComplete="off"
          autoFocus={nouvelle}
        />
      </Champ>
      <ol className="grid gap-5">
        {TEMPS.map((t) => (
          <li key={t.nom} className="grid gap-x-3 sm:grid-cols-[1.25rem_1fr]">
            <span aria-hidden="true" className="hidden pt-px font-mono text-sm text-encre-3 sm:block">
              {t.lettre}
            </span>
            <Champ libelle={t.libelle} htmlFor={`${prefixe}-${t.nom}`} aide={t.aide} erreur={e[t.nom]}>
              <ZoneTexte id={`${prefixe}-${t.nom}`} name={t.nom} defaultValue={objection?.[t.nom]} className="min-h-16" />
            </Champ>
          </li>
        ))}
      </ol>
      {etat?.conflit && etat.message ? (
        <MessageConflit message={etat.message} jeton={etat.conflit.jeton} onRecharger={recharger} rechargement={rechargement} desactive={enCours} />
      ) : etat && !etat.ok && etat.message ? (
        <Message ton="alerte">{etat.message}</Message>
      ) : null}
      <div className="-mx-1.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Action
            type="submit"
            ton="fort"
            touche="Ctrl Entrée"
            enCours={enCours}
            libelleEnCours="Enregistrement…"
            disabled={enCours}
          >
            {nouvelle ? 'Ajouter l’objection' : 'Enregistrer'}
          </Action>
          {onAnnuler ? (
            <Action ton="discret" touche="Échap" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </Action>
          ) : null}
          <span role="status" className="px-1.5 text-sm">
            {modifie ? <span className="text-encre-2">Modifications non enregistrées</span> : etat?.ok && !nouvelle ? <span className="text-encre-3">{etat.message}</span> : null}
          </span>
        </div>
        {archive}
      </div>
    </form>
  );
}
