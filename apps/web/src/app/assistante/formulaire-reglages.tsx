'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Action, Champ, Message, Saisie, Selection, ZoneTexte } from '@/components/ui';
import { type PatchReglages, patchReglagesSchema } from '@/lib/reglages-assistante';
import { lireChemin } from '@/lib/vue-assistante';
import { enregistrerReglagesAction } from './actions';
import { ApercuVoix, ChoixCatalogue, useCatalogueAssistante } from './choix-voix';
import type { CatalogueAssistante } from '@/lib/catalogue-assistante';

/**
 * Les réglages ElevenLabs de la liste fermée, comme modifier_reglages_assistante : mêmes bornes (le schéma partagé
 * prévient avant l'envoi, le serveur reste seul juge), seules les valeurs changées partent, et l'empreinte lue
 * refuse d'écrire par-dessus agent/ modifié ailleurs. Rien ne change pour les appels avant la poussée.
 */

type Genre =
  | { type: 'texte'; mono?: boolean; max: number }
  | { type: 'catalogue'; liste: 'voix' | 'modelesVoix' | 'modelesLangage' }
  | { type: 'curseur'; min: number; max: number; pas: number }
  | { type: 'nombre'; min: number; max: number; unite: string; entier?: boolean }
  | { type: 'choix'; options: [string, string][] }
  | { type: 'case' }
  | { type: 'liste'; max: number; longueur: number }
  | { type: 'expressions' };

interface DefinitionChamp {
  cle: string;
  libelle: string;
  aide: string;
  genre: Genre;
}

const GROUPES: { titre: string; champs: DefinitionChamp[] }[] = [
  {
    titre: 'Modèle',
    champs: [
      { cle: 'langue', libelle: 'Langue de conversation', aide: 'Code de langue : fr, en… Les instructions gardent la langue de leur texte.', genre: { type: 'texte', mono: true, max: 5 } },
      { cle: 'llm', libelle: 'Modèle de langage', aide: 'Identifiant ElevenLabs : a-z, 0-9, point, tiret, tiret bas.', genre: { type: 'catalogue', liste: 'modelesLangage' } },
      { cle: 'temperature', libelle: 'Température', aide: 'De 0 (constante) à 1 (variée).', genre: { type: 'curseur', min: 0, max: 1, pas: 0.05 } },
    ],
  },
  {
    titre: 'Voix',
    champs: [
      { cle: 'voix.voiceId', libelle: 'Voix', aide: '10 à 40 lettres ou chiffres, tel qu’ElevenLabs le donne.', genre: { type: 'catalogue', liste: 'voix' } },
      { cle: 'voix.modele', libelle: 'Modèle de voix', aide: 'Un modèle eleven_…', genre: { type: 'catalogue', liste: 'modelesVoix' } },
      { cle: 'voix.stabilite', libelle: 'Stabilité', aide: 'De 0 à 1.', genre: { type: 'curseur', min: 0, max: 1, pas: 0.05 } },
      { cle: 'voix.similarite', libelle: 'Similarité', aide: 'De 0 à 1.', genre: { type: 'curseur', min: 0, max: 1, pas: 0.05 } },
      { cle: 'voix.vitesse', libelle: 'Vitesse', aide: 'De 0,7 à 1,2.', genre: { type: 'curseur', min: 0.7, max: 1.2, pas: 0.01 } },
      { cle: 'voix.expressif', libelle: 'Mode expressif', aide: 'Autorise la voix à jouer les émotions et les intonations.', genre: { type: 'case' } },
      { cle: 'voix.expressions', libelle: 'Expressions suggérées', aide: 'Suggestions d’intonation : leur usage reste guidé par le prompt. Une liste vide ne suggère aucune expression.', genre: { type: 'expressions' } },
    ],
  },
  {
    titre: 'Tour de parole',
    champs: [
      {
        cle: 'tour.empressement',
        libelle: 'Empressement',
        aide: 'Sa hâte à reprendre la parole.',
        genre: { type: 'choix', options: [['patient', 'patient'], ['normal', 'normal'], ['eager', 'pressé (eager)']] },
      },
      { cle: 'tour.delaiSilenceS', libelle: 'Silence avant de reprendre la parole', aide: 'De 1 à 30 s.', genre: { type: 'nombre', min: 1, max: 30, unite: 's' } },
      { cle: 'tour.speculatif', libelle: 'Tour spéculatif', aide: 'Elle prépare sa réponse avant la fin de la phrase du prospect.', genre: { type: 'case' } },
      { cle: 'tour.motsIgnores', libelle: 'Mots qui ne l’interrompent pas', aide: 'Un par ligne, 50 au plus, 30 caractères chacun.', genre: { type: 'liste', max: 50, longueur: 30 } },
      { cle: 'tour.languesMotsIgnores', libelle: 'Langues des mots ignorés', aide: 'Un code par ligne : fr, en…', genre: { type: 'liste', max: 20, longueur: 5 } },
      { cle: 'tour.fusionMotsParDefaut', libelle: 'Inclure les mots ignorés par défaut', aide: 'Ajoute les acquiescements reconnus par ElevenLabs à ta liste.', genre: { type: 'case' } },
    ],
  },
  {
    titre: 'Relances de silence',
    champs: [
      { cle: 'relances.premiere', libelle: 'Première relance', aide: '40 caractères au plus.', genre: { type: 'texte', max: 40 } },
      { cle: 'relances.suivantes', libelle: 'Relances suivantes', aide: 'Une par ligne, 5 au plus, 40 caractères chacune.', genre: { type: 'liste', max: 5, longueur: 40 } },
      { cle: 'relances.delaiS', libelle: 'Après', aide: 'De 0,5 à 5 s de silence pendant qu’elle prépare sa réponse.', genre: { type: 'nombre', min: 0.5, max: 5, unite: 's' } },
      { cle: 'relances.genererParModele', libelle: 'Générer les relances avec le modèle', aide: 'Le modèle rédige la relance selon la conversation.', genre: { type: 'case' } },
      { cle: 'relances.aleatoires', libelle: 'Varier les relances au hasard', aide: 'Choisit parmi les relances enregistrées.', genre: { type: 'case' } },
      { cle: 'relances.nombreMax', libelle: 'Nombre maximal de relances par réponse', aide: 'De 0 à 5.', genre: { type: 'nombre', min: 0, max: 5, unite: 'relances', entier: true } },
      { cle: 'relances.desactiverAvantPremierMessage', libelle: 'Attendre que le prospect ait parlé', aide: 'Désactive les relances avant sa première phrase.', genre: { type: 'case' } },
    ],
  },
  {
    titre: 'Appel',
    champs: [
      {
        cle: 'dureeMaxS',
        libelle: 'Durée maximale',
        aide: 'De 60 à 330 s : le pont raccroche de lui-même à 360 s.',
        genre: { type: 'nombre', min: 60, max: 330, unite: 's', entier: true },
      },
      { cle: 'libelleTableauDeBord', libelle: 'Libellé du tableau de bord', aide: 'Le nom de l’agent chez ElevenLabs, 2 à 60 caractères.', genre: { type: 'texte', max: 60 } },
    ],
  },
];

const CHAMPS = GROUPES.flatMap((g) => g.champs);
const LIBELLES = new Map(CHAMPS.map((c) => [c.cle, c.libelle.toLowerCase()]));
const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function enTexte(valeur: unknown, genre: Genre): string {
  if (valeur === undefined || valeur === null) return '';
  if (genre.type === 'expressions') return JSON.stringify(Array.isArray(valeur) ? valeur : []);
  if (genre.type === 'liste') return Array.isArray(valeur) ? valeur.map(String).join('\n') : '';
  if (genre.type === 'case') return valeur === true ? 'oui' : 'non';
  // Un nombre saisi s'écrit à la française ; le curseur garde le point, que l'élément natif attend.
  if (typeof valeur === 'number') return genre.type === 'nombre' ? String(valeur).replace('.', ',') : String(valeur);
  return String(valeur);
}

const enTextes = (reglages: PatchReglages) => Object.fromEntries(CHAMPS.map((c) => [c.cle, enTexte(lireChemin(reglages, c.cle), c.genre)]));

function enValeur(texte: string, genre: Genre): unknown {
  switch (genre.type) {
    case 'expressions':
      return texte ? JSON.parse(texte) : [];
    case 'liste':
      return texte
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    case 'case':
      return texte === 'oui';
    case 'curseur':
    case 'nombre':
      return texte.trim() === '' ? Number.NaN : Number(texte.trim().replace(',', '.'));
    default:
      return texte.trim();
  }
}

function poser(objet: Record<string, unknown>, cle: string, valeur: unknown) {
  const parties = cle.split('.');
  let courant = objet;
  for (const p of parties.slice(0, -1)) courant = (courant[p] ??= {}) as Record<string, unknown>;
  courant[parties.at(-1) as string] = valeur;
}

export function FormulaireReglages({ reglages, empreinte }: { reglages: PatchReglages; empreinte: string }) {
  const id = useId();
  const catalogue = useCatalogueAssistante();
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);
  const [valeurs, setValeurs] = useState<Record<string, string>>(() => enTextes(reglages));
  const [empreinteConnue, setEmpreinteConnue] = useState(empreinte);
  const [montrerErreurs, setMontrerErreurs] = useState(false);
  const [retour, setRetour] = useState<{ ton: 'neutre' | 'alerte'; texte: string; perime?: boolean } | null>(null);
  const [envoi, envoyer] = useTransition();
  const [rechargement, recharger] = useTransition();

  // Les réglages relus changent (enregistrés ici, par Claude Code ou par un rapatriement) : la saisie suit tant
  // qu'elle est intacte. Une saisie modifiée garde son empreinte pour refuser une écriture concurrente.
  const initiales = enTextes(reglages);
  const [base, setBase] = useState({ initiales, empreinte });
  if (base.empreinte !== empreinte) {
    setBase({ initiales, empreinte });
    if (CHAMPS.every((c) => valeurs[c.cle] === base.initiales[c.cle])) {
      setValeurs(initiales);
      setEmpreinteConnue(empreinte);
    }
  }

  // « 1,2 » et « 1.2 » disent la même chose : un champ n'est modifié que si sa valeur lue change.
  const differe = (c: DefinitionChamp) =>
    valeurs[c.cle] !== initiales[c.cle] && JSON.stringify(enValeur(valeurs[c.cle] ?? '', c.genre)) !== JSON.stringify(enValeur(initiales[c.cle] ?? '', c.genre));
  const changes = CHAMPS.filter(differe);
  const patch: Record<string, unknown> = {};
  for (const c of changes) poser(patch, c.cle, enValeur(valeurs[c.cle] ?? '', c.genre));
  const verification = patchReglagesSchema.safeParse(patch);
  const erreurs: Record<string, string> = {};
  if (!verification.success) for (const i of verification.error.issues) erreurs[i.path.slice(0, i.path[0] === 'voix' && i.path[1] === 'expressions' ? 2 : undefined).filter((p) => typeof p === 'string').join('.')] ??= i.message;

  useRaccourci({
    touche: 'Enter',
    ctrl: true,
    dansChamp: true,
    libelle: 'Enregistrer les réglages dans agent/',
    actif: changes.length > 0 && !envoi,
    action: () => {
      if (!formulaire.current?.contains(document.activeElement)) return false;
      formulaire.current.requestSubmit();
    },
  });

  const surEnvoi = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (changes.length === 0 || envoi) return;
    if (!verification.success) {
      setMontrerErreurs(true);
      const f = e.currentTarget;
      requestAnimationFrame(() => f.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setRetour(null);
    envoyer(async () => {
      const r = await enregistrerReglagesAction(verification.data, empreinteConnue);
      if (!r.ok) {
        setRetour({ ton: 'alerte', texte: r.raison, perime: r.raison.includes('recharge la page') });
        return;
      }
      setEmpreinteConnue(r.empreinteLocale);
      setMontrerErreurs(false);
      setRetour({
        ton: 'neutre',
        texte: `Enregistré dans agent/ : ${r.champs.map((c) => LIBELLES.get(c) ?? c).join(', ')}. ${r.rappel}${r.avertissement ? ` ${r.avertissement}` : ''}`,
      });
      router.refresh();
    });
  };

  const changer = (cle: string, texte: string) => {
    setValeurs((v) => ({ ...v, [cle]: texte }));
    setRetour(null);
  };

  return (
    <form ref={formulaire} onSubmit={surEnvoi} noValidate className="grid gap-8" aria-busy={envoi}>
      {GROUPES.map((g) => (
        <fieldset key={g.titre} className="grid min-w-0 gap-5">
          <legend className="pb-3 text-md font-semibold">{g.titre}</legend>
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-6">
            {g.champs.map((c) => (
              <ChampReglage
                key={c.cle}
                id={`${id}-${c.cle.replace('.', '-')}`}
                definition={c}
                catalogue={catalogue}
                valeur={valeurs[c.cle] ?? ''}
                modifie={differe(c)}
                erreur={montrerErreurs ? erreurs[c.cle] : undefined}
                desactive={envoi}
                onChange={(t) => changer(c.cle, t)}
              />
            ))}
          </div>
          {g.titre === 'Voix' ? <ApercuVoix valeurs={valeurs} desactive={envoi} /> : null}
        </fieldset>
      ))}

      {catalogue?.indisponibles.length ? <Message ton="neutre">Catalogue indisponible : {catalogue.indisponibles.join(', ').toLowerCase()}. Tu peux saisir les identifiants.</Message> : null}

      {retour ? (
        <Message
          ton={retour.ton}
          action={
            retour.perime ? (
              <Action
                ton="normal"
                enCours={rechargement}
                libelleEnCours="Rechargement…"
                onClick={() =>
                  recharger(() => {
                    router.refresh();
                    setValeurs(initiales);
                    setEmpreinteConnue(empreinte);
                    setRetour(null);
                  })
                }
              >
                Recharger
              </Action>
            ) : undefined
          }
        >
          {retour.texte}
        </Message>
      ) : null}

      <div className="grid gap-2">
        <p className="text-sm text-encre-3" aria-live="polite">
          {changes.length
            ? `${changes.length} réglage${changes.length > 1 ? 's' : ''} modifié${changes.length > 1 ? 's' : ''} : ${changes.map((c) => c.libelle.toLowerCase()).join(', ')}.`
            : 'Aucun réglage modifié.'}
        </p>
        <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pointer-coarse:mx-0">
          <Action type="submit" ton="fort" touche="Ctrl Entrée" disabled={changes.length === 0 || envoi} enCours={envoi} libelleEnCours="Enregistrement…">
            Enregistrer dans agent/
          </Action>
          {changes.length && !envoi ? (
            <Action
              ton="discret"
              onClick={() => {
                setValeurs(initiales);
                setEmpreinteConnue(empreinte);
                setMontrerErreurs(false);
                setRetour(null);
              }}
            >
              Revenir aux réglages de agent/
            </Action>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function ChampReglage({
  id,
  definition: c,
  catalogue,
  valeur,
  modifie,
  erreur,
  desactive,
  onChange,
}: {
  id: string;
  definition: DefinitionChamp;
  catalogue: CatalogueAssistante | null;
  valeur: string;
  modifie: boolean;
  erreur: string | undefined;
  desactive: boolean;
  onChange: (texte: string) => void;
}) {
  const g = c.genre;
  const marque = modifie ? <span className="text-sm text-encre-3">modifié</span> : null;

  if (g.type === 'catalogue') return <ChoixCatalogue id={id} libelle={c.libelle} valeur={valeur} choix={catalogue?.[g.liste] ?? []} desactive={desactive} erreur={erreur} modifie={modifie} onChange={onChange} />;

  if (g.type === 'case') {
    return (
      <div className="grid content-start gap-1.5">
        <label htmlFor={id} className="flex items-center gap-2.5 text-sm font-medium text-encre pointer-coarse:min-h-11">
          <input
            id={id}
            type="checkbox"
            className="size-4 accent-[var(--encre)]"
            checked={valeur === 'oui'}
            disabled={desactive}
            aria-describedby={`${id}-aide`}
            onChange={(e) => onChange(e.target.checked ? 'oui' : 'non')}
          />
          {c.libelle}
          {marque}
        </label>
        <p id={`${id}-aide`} className="text-sm text-encre-3">
          {c.aide}
        </p>
      </div>
    );
  }

  if (g.type === 'curseur') {
    const nombre = valeur === '' ? null : Number(valeur);
    return (
      <Champ
        libelle={c.libelle}
        htmlFor={id}
        aide={c.aide}
        erreur={erreur}
        complement={
          <span className="flex items-baseline gap-2">
            {marque}
            <output htmlFor={id} className="font-mono text-sm text-encre">
              {nombre === null ? <span className="text-encre-3">non défini</span> : NOMBRE.format(nombre)}
            </output>
          </span>
        }
      >
        <input
          id={id}
          type="range"
          min={g.min}
          max={g.max}
          step={g.pas}
          value={nombre ?? (g.min + g.max) / 2}
          disabled={desactive}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full cursor-pointer accent-[var(--encre)] disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:h-11"
        />
      </Champ>
    );
  }

  if (g.type === 'choix') {
    return (
      <Champ libelle={c.libelle} htmlFor={id} aide={c.aide} erreur={erreur} complement={marque}>
        <Selection id={id} value={valeur} disabled={desactive} onChange={(e) => onChange(e.target.value)}>
          {valeur === '' ? <option value="">non défini</option> : null}
          {g.options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Selection>
      </Champ>
    );
  }

  if (g.type === 'expressions') {
    return <ChampExpressions id={id} valeur={valeur} definition={c} erreur={erreur} desactive={desactive} modifie={modifie} onChange={onChange} />;
  }

  if (g.type === 'liste') {
    return (
      <Champ libelle={c.libelle} htmlFor={id} aide={c.aide} erreur={erreur} complement={marque}>
        <ZoneTexte id={id} value={valeur} rows={3} disabled={desactive} soumissionClavier={false} onChange={(e) => onChange(e.target.value)} />
      </Champ>
    );
  }

  if (g.type === 'nombre') {
    return (
      <Champ libelle={c.libelle} htmlFor={id} aide={c.aide} erreur={erreur} complement={marque}>
        <span className="flex items-baseline gap-2" aria-invalid={false}>
          <span className="w-24 shrink-0">
            <Saisie
              id={id}
              type="text"
              inputMode={g.entier ? 'numeric' : 'decimal'}
              autoComplete="off"
              value={valeur}
              disabled={desactive}
              aria-invalid={erreur ? true : undefined}
              aria-describedby={`${id}-aide${erreur ? ` ${id}-erreur` : ''}`}
              onChange={(e) => onChange(e.target.value)}
              className="font-mono"
            />
          </span>
          <span className="text-sm text-encre-3">{g.unite}</span>
        </span>
      </Champ>
    );
  }

  return (
    <Champ libelle={c.libelle} htmlFor={id} aide={c.aide} erreur={erreur} complement={marque}>
      <Saisie
        id={id}
        autoComplete="off"
        spellCheck={false}
        maxLength={g.max}
        value={valeur}
        disabled={desactive}
        onChange={(e) => onChange(e.target.value)}
        className={g.mono ? 'font-mono' : ''}
      />
    </Champ>
  );
}

function ChampExpressions({ id, valeur, definition, erreur, desactive, modifie, onChange }: {
  id: string; valeur: string; definition: DefinitionChamp; erreur?: string; desactive: boolean; modifie: boolean; onChange: (texte: string) => void;
}) {
  const expressions: { tag: string; description: string }[] = valeur ? JSON.parse(valeur) : [];
  const changer = (index: number, patch: Partial<{ tag: string; description: string }>) =>
    onChange(JSON.stringify(expressions.map((e, i) => i === index ? { ...e, ...patch } : e)));
  return (
    <fieldset className="grid min-w-0 gap-3 sm:col-span-2" aria-describedby={`${id}-aide${erreur ? ` ${id}-erreur` : ''}`}>
      <legend className="pb-1 text-sm font-medium">{definition.libelle}{modifie ? <span className="ml-2 font-normal text-encre-3">modifié</span> : null}</legend>
      <p id={`${id}-aide`} className="text-sm text-encre-3">{definition.aide}</p>
      {expressions.map((e, i) => (
        <div key={i} className="grid min-w-0 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
          <Champ libelle={`Expression ${i + 1}`} htmlFor={`${id}-tag-${i}`}>
            <Saisie id={`${id}-tag-${i}`} value={e.tag} aria-invalid={erreur ? true : undefined} placeholder="warmly" maxLength={50} disabled={desactive} onChange={(event) => changer(i, { tag: event.target.value })} className="font-mono" />
          </Champ>
          <Champ libelle={`Description ${i + 1}`} htmlFor={`${id}-description-${i}`}>
            <Saisie id={`${id}-description-${i}`} value={e.description} aria-invalid={erreur ? true : undefined} maxLength={500} disabled={desactive} onChange={(event) => changer(i, { description: event.target.value })} />
          </Champ>
          <Action disabled={desactive} aria-label={`Retirer l’expression ${i + 1}`} onClick={() => onChange(JSON.stringify(expressions.filter((_, index) => index !== i)))}>Retirer</Action>
        </div>
      ))}
      {erreur ? <p id={`${id}-erreur`} className="text-sm text-alerte">{erreur}</p> : null}
      <Action className="justify-self-start" disabled={desactive || expressions.length >= 32} onClick={() => onChange(JSON.stringify([...expressions, { tag: '', description: '' }]))}>Ajouter une expression</Action>
    </fieldset>
  );
}
