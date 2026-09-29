'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, use, useId, useState, useTransition } from 'react';
import { demarrerAppelTelephone, lancerSimulation } from '@/app/appels/actions';
import { phrasePlafonds } from '@/app/campagnes/[id]/recapitulatif';
import { AjoutClaudeCode } from '@/components/ajout-claude-code';
import { AppelEnDirect } from '@/components/appel-en-direct';
import { useNomAssistante } from '@/components/assistante';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { numeroMasque, prenom as prenomDe } from '@/components/format-appel';
import type { ReglagesLigne } from '@/components/garde-fous';
import { Action, LienAction, Message, PointCreux, Selection } from '@/components/ui';

/**
 * Appeler un prospect depuis sa fiche : une version, une ligne, et une action dont la forme suit la gravité.
 * Navigateur (défaut) : le panneau de conversation au micro ; simulation : un clic ; téléphone : un vrai numéro
 * sonne, donc une confirmation qui redit le numéro, la version et les plafonds de la ligne.
 */

type Ligne = 'navigateur' | 'simulation' | 'telephone';

/** Même ordre et même défaut que la création d'une campagne. */
const LIGNES: { valeur: Ligne; libelle: string; aide: (assistante: string) => string }[] = [
  { valeur: 'navigateur', libelle: 'Navigateur', aide: () => 'Test : tu joues le prospect au micro, rien n’est composé.' },
  { valeur: 'simulation', libelle: 'Simulation', aide: () => 'Un modèle joue le prospect, sans audio. Signalé comme simulé partout.' },
  { valeur: 'telephone', libelle: 'Téléphone', aide: (assistante) => `${assistante} appelle le vrai numéro depuis le téléphone passerelle.` },
];

export type PlafondsLigne = { reglages: ReglagesLigne | null; passes24h: number | null };
/** Pourquoi le téléphone passerelle ne peut rien composer : phrase complète, et version courte pour le choix de ligne. */
export type BlocageTelephone = { texte: string; court: string };

/** « · déconnecté » après « Téléphone » dans le choix de ligne, quand la ligne ne peut rien composer. */
function SuffixeTelephone({ promesse }: { promesse: Promise<BlocageTelephone | null> }) {
  const bloque = use(promesse);
  return bloque ? <span className="font-normal text-encre-3">&nbsp;· {bloque.court}</span> : null;
}

/** Le geste « Appeler le 06… », désactivé avec sa raison quand le téléphone passerelle ne peut rien composer. */
function GesteTelephone({
  promesse,
  children,
}: {
  promesse: Promise<BlocageTelephone | null>;
  children: (bloque: boolean) => React.ReactNode;
}) {
  const bloque = use(promesse);
  if (!bloque) return <>{children(false)}</>;
  return (
    <>
      {children(true)}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-sm text-encre-2">
          <PointCreux className="mr-2" />
          {bloque.texte} Aucun appel ne peut partir par le téléphone.
        </p>
        <LienAction ton="discret" href="/telephone" className="-mx-1.5">
          Ouvrir Téléphone
        </LienAction>
      </div>
    </>
  );
}

/** Le numéro masqué pour l'écran partagé ; « Afficher le numéro » le montre en clair, sans rien écrire. */
export function NumeroMasquable({ lisible }: { lisible: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
      <p className="font-mono text-lg tracking-[-0.01em]" aria-live="polite">
        {visible ? lisible : numeroMasque(lisible)}
        {visible ? null : <span className="sr-only"> (numéro masqué)</span>}
      </p>
      <Action ton="discret" className="-mx-1.5" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
        {visible ? 'Masquer le numéro' : 'Afficher le numéro'}
      </Action>
    </div>
  );
}

function Plafonds({ promesse }: { promesse: Promise<PlafondsLigne> }) {
  const { reglages, passes24h } = use(promesse);
  return <>{phrasePlafonds(reglages, passes24h)}</>;
}

export function PanneauAppel({
  entrepriseId,
  prospectId,
  prospectNom,
  versions,
  autorise,
  numero,
  ajoutMcp = null,
  blocage = null,
  plafonds,
  telephoneBloque,
}: {
  entrepriseId: string;
  prospectId: string;
  prospectNom: string;
  versions: { id: string; libelle: string }[];
  autorise: boolean;
  /** Numéro lisible (« 06 39 98 00 01 »), déjà formaté par le serveur. */
  numero: string;
  /** Date d'entrée du numéro par le serveur MCP (ADR 0009), redite dans la confirmation ; null s'il vient de l'interface. */
  ajoutMcp?: Date | null;
  /** Pourquoi aucun appel n'est possible, avec le lien qui le règle s'il y en a un. */
  blocage?: { texte: string; lien?: { href: string; libelle: string } } | null;
  /** Plafonds de la ligne téléphone, lus sans bloquer la page (le pont peut tarder). */
  plafonds: Promise<PlafondsLigne>;
  /** Pourquoi le téléphone passerelle ne peut rien composer, ou null ; lu sans bloquer la page. */
  telephoneBloque: Promise<BlocageTelephone | null>;
}) {
  const router = useRouter();
  const idAide = useId();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? '');
  const [ligne, setLigne] = useState<Ligne>('navigateur');
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const nomAssistante = useNomAssistante();

  if (blocage || !autorise || versions.length === 0) {
    const texte = blocage?.texte ?? (versions.length === 0 ? 'Aucun script : crées-en un dans Scripts.' : 'Ce numéro n’est pas autorisé : aucun appel possible.');
    return (
      <section aria-label="Appeler" className="grid gap-2 border-t border-filet pt-4">
        <p className="text-md text-encre-2">{texte}</p>
        {blocage?.lien ? (
          <Link href={blocage.lien.href} className="justify-self-start text-md text-encre decoration-souligne underline-offset-4 hover:underline">
            {blocage.lien.libelle}
          </Link>
        ) : null}
      </section>
    );
  }

  const prenom = prenomDe(prospectNom);
  const libelleVersion = versions.find((v) => v.id === versionId)?.libelle ?? '';
  const aide = LIGNES.find((l) => l.valeur === ligne)?.aide(nomAssistante);

  const lancer = (action: () => Promise<{ ok: true; appelId: string } | { ok: false; raison: string }>, apres?: () => void) =>
    demarrer(async () => {
      setErreur(null);
      try {
        const r = await action();
        if (r.ok) router.push(`/appels/${r.appelId}`);
        else setErreur(r.raison);
      } catch {
        setErreur('L’appel n’a pas pu être lancé : le serveur n’a pas répondu.');
      }
      apres?.();
    });

  return (
    <section aria-label="Appeler" className="grid gap-5 border-t border-filet pt-4">
      <div className="grid gap-1.5">
        <label htmlFor="version-appel" className="text-sm font-medium">
          Version de script
        </label>
        <Selection id="version-appel" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.libelle}
            </option>
          ))}
        </Selection>
      </div>

      <fieldset className="grid gap-1.5" aria-describedby={idAide}>
        <legend className="mb-1 text-sm font-medium">Ligne</legend>
        <div className="flex flex-wrap gap-x-[22px]">
          {LIGNES.map((l) => (
            <label
              key={l.valeur}
              className="inline-flex cursor-pointer items-baseline rounded-[4px] py-1 text-md text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline has-[:checked]:font-semibold has-[:checked]:text-encre has-[:checked]:no-underline has-[:checked]:shadow-[inset_0_-1.5px_0_var(--encre)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus pointer-coarse:py-2.5"
            >
              <input
                type="radio"
                name="ligne-appel"
                value={l.valeur}
                checked={ligne === l.valeur}
                onChange={() => {
                  setLigne(l.valeur);
                  setErreur(null);
                  if (confirmation.ouverte) confirmation.fermer();
                }}
                className="sr-only"
              />
              {l.libelle}
              {l.valeur === 'telephone' ? (
                <Suspense fallback={null}>
                  <SuffixeTelephone promesse={telephoneBloque} />
                </Suspense>
              ) : null}
            </label>
          ))}
        </div>
        <p id={idAide} className="text-sm text-encre-3">
          {aide}
        </p>
      </fieldset>

      {ligne === 'navigateur' ? (
        <AppelEnDirect key={versionId} entrepriseId={entrepriseId} prospectId={prospectId} prospectNom={prospectNom} versionScriptId={versionId} />
      ) : ligne === 'simulation' ? (
        <div className="-mx-1.5">
          <Action
            enCours={enCours}
            libelleEnCours="Simulation…"
            disabled={enCours}
            onClick={() => lancer(() => lancerSimulation(entrepriseId, prospectId, versionId))}
          >
            Simuler l’appel de {prenom}
          </Action>
        </div>
      ) : (
        <div className="grid gap-3">
          <Suspense
            fallback={
              <div className="-mx-1.5">
                <Action ton="fort" disabled enCours libelleEnCours="Lecture de la ligne…">
                  Appeler le {numeroMasque(numero)}
                </Action>
              </div>
            }
          >
            <GesteTelephone promesse={telephoneBloque}>
              {(bloque) => (
                <div className="-mx-1.5">
                  <Action
                    ton="fort"
                    disabled={enCours || bloque}
                    aria-expanded={confirmation.ouverte}
                    onClick={(e) => confirmation.ouvrir(e.currentTarget)}
                  >
                    Appeler le {numeroMasque(numero)}
                  </Action>
                </div>
              )}
            </GesteTelephone>
          </Suspense>
          <Confirmation
            ouverte={confirmation.ouverte}
            question={`Appeler ${prospectNom} sur le téléphone passerelle ?`}
            libelleConfirmer="Appeler"
            enCours={enCours}
            libelleEnCours="Composition…"
            onAnnuler={confirmation.fermer}
            onConfirmer={() => lancer(() => demarrerAppelTelephone(entrepriseId, prospectId, versionId), confirmation.fermer)}
          >
            <p>
              Le <span className="font-mono text-encre">{numero}</span> va sonner. Version : {libelleVersion}.
            </p>
            {ajoutMcp ? (
              <p className="mt-1">
                <AjoutClaudeCode le={ajoutMcp} />
              </p>
            ) : null}
            <p className="mt-1">
              <Suspense fallback="Lecture des plafonds de la ligne…">
                <Plafonds promesse={plafonds} />
              </Suspense>
            </p>
          </Confirmation>
        </div>
      )}
      {erreur ? <Message ton="alerte">{erreur}</Message> : null}
    </section>
  );
}
