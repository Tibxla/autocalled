'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormulaire } from '@/components/use-formulaire';
import { Action, Message } from '@/components/ui';
import { type RapportImport, importerFiches } from './actions';

/**
 * Import de fiches prospect Markdown. Un refus (fichier trop lourd, attestation non cochée) garde les fichiers
 * choisis ; un import réussi vide le formulaire, pour qu'aucun « 3 fiches choisies » ne survive à l'envoi.
 */

/** Fiche fictive du dépôt (exemples/prospects/julie-martin.md) : le format exact attendu. */
const MODELE = `---
nom: Julie Martin
societe: Gîte des Aravis
role: Gérante
telephone: "06 39 98 00 01"
---

Gîte de quatre chambres près d'Annecy, ouvert depuis 2019.
Site vitrine ancien, sans réservation en ligne : tout passe par Booking, à environ 17 % de commission.
Très présente sur Instagram, répond elle-même aux avis Google.
Piste : parler du coût de la commission, pas du design du site.
`;

function pluriel(n: number, mot: string, pluriel = `${mot}s`): string {
  return `${n} ${n > 1 ? pluriel : mot}`;
}

function LigneRapport({ libelle, ids }: { libelle: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <li className="grid gap-x-4 gap-y-0.5 border-b border-filet py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <span className="font-medium">{libelle}</span>
      <span className="font-mono text-xs leading-5 break-words text-encre-3">{ids.join(', ')}</span>
    </li>
  );
}

function Rapport({ rapport }: { rapport: Extract<RapportImport, { etat: 'fait' }> }) {
  const total = rapport.crees.length + rapport.misAJour.length + rapport.inchanges.length;
  return (
    <div role="status" className="grid gap-3">
      <p className="text-md font-medium">
        {pluriel(total, 'fiche importée', 'fiches importées')}
        {rapport.refus.length > 0 ? <span className="text-alerte"> · {pluriel(rapport.refus.length, 'fiche refusée', 'fiches refusées')}</span> : null}
      </p>
      {rapport.refus.length > 0 ? (
        <ul aria-label="Fiches refusées" className="grid gap-1 rounded-md bg-alerte-fond px-3.5 py-2.5 text-sm text-alerte">
          {rapport.refus.map((r) => (
            <li key={r.nomFichier} className="grid gap-x-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <span className="font-mono break-all">{r.nomFichier}</span>
              <span>{r.erreurs.join(' ; ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="border-t border-filet text-sm">
        <LigneRapport libelle={pluriel(rapport.crees.length, 'créée', 'créées')} ids={rapport.crees} />
        <LigneRapport libelle={pluriel(rapport.misAJour.length, 'mise à jour', 'mises à jour')} ids={rapport.misAJour} />
        <LigneRapport libelle={pluriel(rapport.inchanges.length, 'inchangée', 'inchangées')} ids={rapport.inchanges} />
        {rapport.numerosAutorises > 0 ? (
          <li className="border-b border-filet py-2 text-encre-2">
            {pluriel(rapport.numerosAutorises, 'numéro autorisé', 'numéros autorisés')} par cet import.
          </li>
        ) : null}
        {rapport.numerosRevoques.length > 0 ? (
          <li className="grid gap-x-4 border-b border-filet py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <span className="text-encre-2">
              {rapport.numerosRevoques.length > 1 ? 'Révoqués, non réautorisés' : 'Révoqué, non réautorisé'}
            </span>
            <span className="font-mono text-xs leading-5 text-encre-3">{rapport.numerosRevoques.join(', ')}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function FormulaireImport({
  entrepriseId,
  texteConsentement,
  focusAuMontage = false,
}: {
  entrepriseId: string;
  texteConsentement: string;
  /** Ouvert par l'opérateur (I, ou le bouton) : le focus va sur le choix des fichiers. */
  focusAuMontage?: boolean;
}) {
  const { etat: rapport, enCours, proprietes } = useFormulaire<RapportImport>(importerFiches.bind(null, entrepriseId), { etat: 'vide' }, {
    estSucces: (r) => r.etat === 'fait',
  });
  const [noms, setNoms] = useState<string[]>([]);
  const [survol, setSurvol] = useState(false);
  const [copie, setCopie] = useState<'copie' | 'impossible' | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusAuMontage) champ.current?.focus();
  }, [focusAuMontage]);

  // Import fait : le formulaire se vide (les fiches sont en base, le rapport reste affiché).
  const [rapportVu, setRapportVu] = useState(rapport);
  if (rapport !== rapportVu) {
    setRapportVu(rapport);
    if (rapport.etat === 'fait') setNoms([]);
  }
  useEffect(() => {
    if (rapport.etat === 'fait') proprietes.ref.current?.reset();
  }, [rapport, proprietes.ref]);

  const choisir = (fichiers: FileList | null) => setNoms([...(fichiers ?? [])].map((f) => f.name));

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(MODELE);
      setCopie('copie');
    } catch {
      setCopie('impossible');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <form {...proprietes} className="grid content-start gap-5" aria-label="Importer des fiches prospect">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setSurvol(true);
          }}
          onDragLeave={() => setSurvol(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSurvol(false);
            if (!champ.current || e.dataTransfer.files.length === 0) return;
            champ.current.files = e.dataTransfer.files;
            choisir(e.dataTransfer.files);
          }}
          className={`grid cursor-pointer justify-items-start gap-1.5 rounded-md border border-dashed px-5 py-6 transition-colors duration-150 hover:border-encre hover:bg-survol has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
            survol ? 'border-encre bg-survol' : 'border-filet-fort'
          }`}
        >
          <span className="font-medium">
            {noms.length === 0 ? 'Dépose les fiches ici ou choisis-les' : `${pluriel(noms.length, 'fiche choisie', 'fiches choisies')}`}
          </span>
          {noms.length === 0 ? (
            <span className="text-sm text-encre-3">
              Un fichier <span className="font-mono">.md</span> par prospect, 100 au plus, 32 Ko chacun. Son nom devient l’identifiant :{' '}
              <span className="font-mono">julie-martin.md</span>.
            </span>
          ) : (
            <span className="font-mono text-xs leading-5 break-all text-encre-2">{noms.join(', ')}</span>
          )}
          <input
            ref={champ}
            type="file"
            name="fiches"
            accept=".md,text/markdown"
            multiple
            required
            className="sr-only"
            onChange={(e) => choisir(e.target.files)}
          />
        </label>

        <label className="flex items-start gap-3">
          <input type="checkbox" name="consentement" required className="mt-1 size-4 shrink-0 accent-[var(--encre)]" />
          <span className="grid gap-1">
            <span className="text-md">Chaque personne de cette liste a accepté ce texte :</span>
            <span className="text-base text-encre-2">« {texteConsentement} »</span>
          </span>
        </label>

        <div className="-mx-1.5 flex flex-wrap items-center gap-x-4">
          <Action ton="fort" type="submit" disabled={noms.length === 0 || enCours} enCours={enCours} libelleEnCours="Import…">
            {noms.length === 0 ? 'Importer des fiches' : `Importer ${pluriel(noms.length, 'fiche')}`}
          </Action>
          {noms.length === 0 ? <span className="px-1.5 text-sm text-encre-3">Choisis d’abord des fichiers.</span> : null}
        </div>

        {rapport.etat === 'erreur' ? <Message ton="alerte">{rapport.message}</Message> : null}
        {rapport.etat === 'fait' ? <Rapport rapport={rapport} /> : null}
      </form>

      <section aria-labelledby="titre-modele" className="grid content-start gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 id="titre-modele" className="text-md font-semibold">
            Modèle de fiche
          </h3>
          <div className="-mx-1.5 flex items-center gap-2">
            <span role="status" className="text-sm text-encre-3">
              {copie === 'copie' ? 'Modèle copié' : copie === 'impossible' ? 'Copie impossible : sélectionne le texte.' : null}
            </span>
            <Action ton="discret" onClick={() => void copier()}>
              Copier le modèle
            </Action>
          </div>
        </div>
        <pre className="overflow-x-auto rounded-md bg-surface px-3.5 py-3 font-mono text-xs leading-5 whitespace-pre-wrap text-encre-2">{MODELE}</pre>
        <p className="text-sm text-encre-3">
          <span className="font-mono">nom</span> et <span className="font-mono">telephone</span> sont obligatoires ;{' '}
          <span className="font-mono">societe</span>, <span className="font-mono">role</span> et <span className="font-mono">email</span>{' '}
          facultatifs. Sous l’en-tête, le contexte que Mina doit connaître : 500 mots au plus. Réimporter un fichier du même nom met la fiche à
          jour.
        </p>
      </section>
    </div>
  );
}
