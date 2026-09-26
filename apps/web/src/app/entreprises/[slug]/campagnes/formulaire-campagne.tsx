'use client';

import { useActionState } from 'react';
import { nouvelleCampagne } from '@/app/campagnes/actions';
import { Bouton, Champ, Message, Selection } from '@/components/ui';

export function FormulaireCampagne({
  entrepriseId,
  versions,
  prospects,
}: {
  entrepriseId: string;
  versions: { id: string; libelle: string }[];
  prospects: { id: string; nom: string; detail: string; autorise: boolean }[];
}) {
  const [etat, action, enCours] = useActionState(nouvelleCampagne.bind(null, entrepriseId), null);
  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Champ libelle="Version de script" htmlFor="versionScriptId">
          <Selection id="versionScriptId" name="versionScriptId" className="font-mono">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.libelle}
              </option>
            ))}
          </Selection>
        </Champ>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Ligne</legend>
          <label className="flex items-center gap-2.5 text-sm">
            <input type="radio" name="ligne" value="navigateur" defaultChecked className="size-4 accent-[var(--encre)]" />
            Ligne navigateur : tu joues chaque prospect
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <input type="radio" name="ligne" value="simulation" className="size-4 accent-[var(--encre)]" />
            Simulation : un modèle joue les prospects
          </label>
        </fieldset>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Prospects, dans l’ordre d’appel</legend>
        <ul className="grid divide-y divide-filet border-y border-filet">
          {prospects.map((p) => (
            <li key={p.id}>
              <label className={`flex items-baseline gap-3 py-2.5 text-sm ${p.autorise ? '' : 'text-encre-3'}`}>
                <input
                  type="checkbox"
                  name="prospects"
                  value={p.id}
                  defaultChecked={p.autorise}
                  disabled={!p.autorise}
                  className="size-4 translate-y-0.5 accent-[var(--encre)]"
                />
                <span className="font-medium">{p.nom}</span>
                <span className="truncate text-encre-3">{p.autorise ? p.detail : 'numéro non autorisé'}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="flex items-center gap-4">
        <Bouton type="submit" disabled={enCours || versions.length === 0}>
          {enCours ? 'Création…' : 'Créer la campagne'}
        </Bouton>
        {etat?.message ? <Message ton="alerte">{etat.message}</Message> : null}
      </div>
    </form>
  );
}
