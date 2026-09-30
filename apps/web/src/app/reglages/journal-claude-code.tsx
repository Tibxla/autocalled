'use client';

import { useState } from 'react';
import { dateCourte, LIGNES_COURTES, numeroMasque } from '@/components/format-appel';
import { Action, Chevron, EtatVide, Filtre, Filtres } from '@/components/ui';
import { estLectureMcp, libelleOutilMcp } from '@/lib/outils-mcp';

/**
 * Le journal des outils du serveur MCP d'Autocalled appelés par Claude Code (ADR 0009). Les lectures y sont
 * aussi : on sait ce que Claude a lu avant d'agir. Filtres locaux sur les lignes chargées, « Gestes » par
 * défaut pour que les lectures ne noient pas ce qui a changé quelque chose.
 */

export type LigneJournal = {
  id: string;
  le: Date;
  outil: string;
  arguments: Record<string, unknown>;
  resultat: 'ok' | 'refus' | 'erreur' | 'confirmation-demandee';
  message: string | null;
  confirmation: 'acceptee' | 'refusee' | 'indisponible' | null;
  /** Noms lus en base pour les identifiants des arguments (slug d'entreprise, identifiant de prospect). */
  noms?: { entreprise?: string; prospect?: string };
};

type Vue = 'gestes' | 'problemes' | 'tout';

/** Une lecture ne change rien : la nature vient de l'annotation readOnlyHint de l'outil (lib/outils-mcp.ts). */
const estLecture = estLectureMcp;

function estProbleme(l: LigneJournal): boolean {
  return l.resultat === 'refus' || l.resultat === 'erreur' || l.confirmation === 'refusee' || l.confirmation === 'indisponible';
}

/** Tout numéro de téléphone masqué (« 06 •• •• •• 40 ») : l'écran peut être partagé. */
const NUMERO = /(?<![\w-])(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\w-])|(?<![\w-])\+\d[\d\s.-]{8,}\d(?![\w-])/g;

function masquer(texte: string): string {
  return texte.replace(NUMERO, (n) => numeroMasque(n));
}

const court = (id: unknown) => (typeof id === 'string' ? id.slice(0, 8) : null);

/** L'argument principal, en quelques mots : prospect, entreprise, valeurs de plafond… */
function resumer(outil: string, a: Record<string, unknown>, noms: LigneJournal['noms'] = {}): string {
  const parties: string[] = [];
  const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (outil === 'regler_ligne') {
    if (typeof a.appelsParHeure === 'number') parties.push(`${a.appelsParHeure} par heure`);
    if (typeof a.appelsParJour === 'number') parties.push(`${a.appelsParJour} par jour`);
    if (typeof a.pauseEntreAppelsS === 'number') parties.push(`pause ${a.pauseEntreAppelsS} s`);
  }
  for (const cle of ['prospect', 'entreprise', 'nom'] as const) {
    const v = cle === 'nom' ? texte(a[cle]) : (noms[cle] ?? texte(a[cle]));
    if (v) parties.push(v);
  }
  if (Array.isArray(a.prospects)) parties.push(`${a.prospects.length} prospect${a.prospects.length > 1 ? 's' : ''}`);
  if (Array.isArray(a.fiches)) parties.push(`${a.fiches.length} fiche${a.fiches.length > 1 ? 's' : ''}`);
  const ligne = texte(a.ligne);
  if (ligne) parties.push(LIGNES_COURTES[ligne] ?? ligne);
  if (typeof a.archivee === 'boolean') parties.push(a.archivee ? 'archivage' : 'réactivation');
  const recherche = texte(a.recherche);
  if (recherche) parties.push(`« ${recherche} »`);
  const issue = texte(a.issue);
  if (issue) parties.push(issue);
  if (parties.length === 0) {
    const id =
      (court(a.appelId) && `appel ${court(a.appelId)}`) ||
      (court(a.campagneId) && `campagne ${court(a.campagneId)}`) ||
      (court(a.rendezVousId) && `rendez-vous ${court(a.rendezVousId)}`) ||
      (court(a.versionScriptId) && `version ${court(a.versionScriptId)}`);
    if (id) parties.push(id);
  }
  return masquer(parties.join(' · '));
}

const RESULTATS: Record<LigneJournal['resultat'], string> = {
  ok: 'fait',
  refus: 'refusé',
  erreur: 'erreur',
  'confirmation-demandee': 'confirmation demandée',
};

const CONFIRMATIONS: Record<NonNullable<LigneJournal['confirmation']>, string> = {
  acceptee: 'accord de l’opérateur',
  refusee: 'refus de l’opérateur',
  indisponible: 'confirmation impossible',
};

/** Le résultat en texte, avec son ton : jamais l'antenne, réservée à ce qui vit. */
function resultat(l: LigneJournal): { texte: string; ton: string } {
  const texte =
    l.confirmation === 'refusee'
      ? 'refusé par l’opérateur'
      : [RESULTATS[l.resultat] ?? l.resultat, l.confirmation ? (CONFIRMATIONS[l.confirmation] ?? l.confirmation) : null].filter(Boolean).join(' · ');
  const ton =
    l.confirmation === 'indisponible' || ((l.resultat === 'refus' || l.resultat === 'erreur') && l.confirmation !== 'refusee')
      ? 'text-alerte'
      : l.resultat === 'confirmation-demandee'
        ? 'text-encre-2'
        : 'text-encre-3';
  return { texte, ton };
}

export function JournalClaudeCode({ lignes }: { lignes: LigneJournal[] }) {
  const [vue, setVue] = useState<Vue>('gestes');

  if (lignes.length === 0) {
    return (
      <EtatVide titre="Claude Code n’a encore appelé aucun outil.">
        Ses lectures et ses gestes apparaîtront ici, du plus récent au plus ancien.
      </EtatVide>
    );
  }

  const gestes = lignes.filter((l) => !estLecture(l.outil));
  const problemes = lignes.filter(estProbleme);
  const visibles = vue === 'gestes' ? gestes : vue === 'problemes' ? problemes : lignes;

  return (
    <div className="grid gap-3">
      <Filtres libelle="Filtrer le journal">
        <Filtre actif={vue === 'gestes'} compte={gestes.length} onClick={() => setVue('gestes')}>
          Gestes
        </Filtre>
        <Filtre actif={vue === 'problemes'} compte={problemes.length} onClick={() => setVue('problemes')}>
          Refus et erreurs
        </Filtre>
        <Filtre actif={vue === 'tout'} compte={lignes.length} onClick={() => setVue('tout')}>
          Tout
        </Filtre>
      </Filtres>
      {visibles.length === 0 ? (
        <EtatVide
          forme="filtre"
          titre={
            vue === 'gestes'
              ? `Aucun geste parmi ${lignes.length > 1 ? `les ${lignes.length} dernières lignes` : 'la dernière ligne'} : seulement des lectures.`
              : 'Aucun refus ni aucune erreur.'
          }
          action={
            <Action ton="normal" onClick={() => setVue('tout')}>
              Tout afficher
            </Action>
          }
        />
      ) : (
        <ol className="border-t border-filet">
          {visibles.map((l) => (
            <LigneDuJournal key={l.id} ligne={l} />
          ))}
        </ol>
      )}
      <p className="text-sm text-encre-3">
        {lignes.length > 1 ? `Les ${lignes.length} derniers appels d’outils.` : 'Le dernier appel d’outil.'} Ouvre une ligne pour voir ses arguments.
      </p>
    </div>
  );
}

function LigneDuJournal({ ligne: l }: { ligne: LigneJournal }) {
  const libelle = libelleOutilMcp(l.outil);
  const resume = resumer(l.outil, l.arguments, l.noms);
  const r = resultat(l);
  const brut = masquer(JSON.stringify(l.arguments, null, 2));
  return (
    <li className="border-b border-filet">
      <details className="group">
        <summary className="relative grid cursor-pointer list-none gap-x-4 gap-y-0.5 py-2 transition-colors duration-100 hover:bg-survol pointer-coarse:active:bg-survol max-sm:pr-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:min-h-[38px] sm:grid-cols-[6.5rem_minmax(0,1fr)_auto_0.625rem] sm:items-baseline [&::-webkit-details-marker]:hidden">
          <time dateTime={l.le.toISOString()} className="font-mono text-xs text-encre-3">
            {dateCourte(l.le)}
          </time>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={`shrink-0 ${estLecture(l.outil) ? 'text-encre-2' : 'font-medium text-encre'}`}>{libelle ?? l.outil}</span>
            {libelle ? <span className="shrink-0 font-mono text-xs text-encre-3 max-sm:hidden">{l.outil}</span> : null}
            {resume ? <span className="min-w-0 truncate text-sm text-encre-3">{resume}</span> : null}
          </span>
          <span className={`text-sm ${r.ton}`}>{r.texte}</span>
          {/* Sous 640 px, en bout de ligne : il dit que la ligne s'ouvre. */}
          <span className="max-sm:absolute max-sm:top-3 max-sm:right-0">
            <Chevron direction="bas" className="stroke-encre-3 group-open:rotate-180" />
          </span>
        </summary>
        <div className="grid gap-1 pb-3 sm:pl-[calc(6.5rem+1rem)]">
          <p className="text-xs text-encre-3">
            Arguments de <span className="font-mono">{l.outil}</span>
          </p>
          <pre className="rounded-md sm:max-h-64 sm:overflow-auto bg-surface px-3 py-2 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-encre-2">
            {brut}
          </pre>
        </div>
      </details>
      {/* Un refus de l'opérateur est déjà dit par le résultat : son message le répéterait. */}
      {l.message && l.resultat !== 'ok' && l.confirmation !== 'refusee' ? (
        <p className="pb-2 text-sm text-encre-3 sm:pl-[calc(6.5rem+1rem)]">{masquer(l.message)}</p>
      ) : null}
    </li>
  );
}
