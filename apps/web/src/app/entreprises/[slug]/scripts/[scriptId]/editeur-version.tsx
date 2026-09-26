'use client';

import { useActionState, useState } from 'react';
import { Bouton, Message, Saisie, ZoneTexte } from '@/components/ui';
import type { Etape } from '@/db/schema';
import { creerVersion } from '../../actions';

let compteur = 0;
const nouvelleCle = () => `etape-${++compteur}`;

export function EditeurVersion({
  entrepriseId,
  scriptId,
  etapes,
  prochainNumero,
}: {
  entrepriseId: string;
  scriptId: string;
  etapes: Etape[];
  prochainNumero: number;
}) {
  const [etat, action, enCours] = useActionState(creerVersion.bind(null, entrepriseId, scriptId), null);
  const [lignes, setLignes] = useState(() => etapes.map((e) => ({ ...e, cle: nouvelleCle() })));

  return (
    <form action={action} className="grid gap-6">
      <ol className="grid gap-px border-y border-filet bg-filet">
        {lignes.map((etape, i) => (
          <li key={etape.cle} className="grid gap-3 bg-fond py-5 sm:grid-cols-[2rem_1fr_auto]">
            <span className="pt-2 font-mono text-sm text-encre-3">{i + 1}</span>
            <div className="grid gap-3">
              <Saisie name="intention" defaultValue={etape.intention} aria-label={`Étape ${i + 1}, intention`} placeholder="Intention de l’étape" />
              <ZoneTexte
                name="exemples"
                defaultValue={etape.exemples.join('\n')}
                aria-label={`Étape ${i + 1}, formulations d’exemple`}
                placeholder="Une ou deux formulations d’exemple, une par ligne"
                className="min-h-16 text-sm"
              />
            </div>
            <div className="flex gap-1 sm:flex-col">
              <Bouton
                type="button"
                variante="discret"
                disabled={i === 0}
                aria-label={`Monter l’étape ${i + 1}`}
                onClick={() => setLignes((l) => l.map((x, j) => (j === i - 1 ? l[i]! : j === i ? l[i - 1]! : x)))}
              >
                ↑
              </Bouton>
              <Bouton
                type="button"
                variante="discret"
                disabled={lignes.length === 1}
                aria-label={`Retirer l’étape ${i + 1}`}
                onClick={() => setLignes((l) => l.filter((_, j) => j !== i))}
              >
                ×
              </Bouton>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Bouton
          type="button"
          variante="secondaire"
          disabled={lignes.length >= 10}
          onClick={() => setLignes((l) => [...l, { intention: '', exemples: [], cle: nouvelleCle() }])}
        >
          Ajouter une étape
        </Bouton>
        <Bouton type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : `Enregistrer comme version ${prochainNumero}`}
        </Bouton>
        {etat?.erreurs?.etapes ? <Message ton="alerte">{etat.erreurs.etapes}</Message> : null}
        {etat?.message ? <Message ton={etat.ok ? 'neutre' : 'alerte'}>{etat.message}</Message> : null}
      </div>
    </form>
  );
}
