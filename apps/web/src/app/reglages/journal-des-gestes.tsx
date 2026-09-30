'use client';

import { useState } from 'react';
import { dateCourte, LIGNES_COURTES, numeroMasque } from '@/components/format-appel';
import { Action, Chevron, EtatVide, Filtre, Filtres } from '@/components/ui';
import { estLectureMcp, libelleOutilMcp } from '@/lib/outils-mcp';

/**
 * Le journal des gestes (ADR 0016) : les outils du serveur MCP d'Autocalled appelés par Claude Code (ADR 0009),
 * lectures comprises, on sait ce que Claude a lu avant d'agir ; et les gestes de l'opérateur sur la page Assistante,
 * nommés comme l'outil qui fait la même chose. Chaque ligne dit son origine. Filtres locaux sur les lignes chargées :
 * « Gestes » par défaut pour que les lectures ne noient pas ce qui a changé quelque chose, et l'origine.
 */

export type OrigineJournal = 'mcp' | 'interface';

export type LigneJournal = {
  id: string;
  le: Date;
  origine: OrigineJournal;
  outil: string;
  arguments: Record<string, unknown>;
  resultat: 'ok' | 'refus' | 'erreur' | 'confirmation-demandee';
  message: string | null;
  confirmation: 'acceptee' | 'refusee' | 'indisponible' | null;
  /** Noms lus en base pour les identifiants des arguments (slug d'entreprise, identifiant de prospect). */
  noms?: { entreprise?: string; prospect?: string };
};

type Vue = 'gestes' | 'problemes' | 'tout';
type Origine = 'toutes' | OrigineJournal;

export const ORIGINES: Record<OrigineJournal, string> = { mcp: 'Claude Code', interface: 'Interface' };

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
    // Le nom de l'assistante, changé depuis la page : l'ancien, puis le nouveau.
    if (v) parties.push(cle === 'nom' && texte(a.nomAvant) ? `${texte(a.nomAvant)} → ${v}` : v);
  }
  if (texte(a.premierMessage) && texte(a.premierMessageAvant)) parties.push('premier message');
  if (Array.isArray(a.prospects)) parties.push(`${a.prospects.length} prospect${a.prospects.length > 1 ? 's' : ''}`);
  if (Array.isArray(a.fiches)) parties.push(`${a.fiches.length} fiche${a.fiches.length > 1 ? 's' : ''}`);
  const ligne = texte(a.ligne);
  if (ligne) parties.push(LIGNES_COURTES[ligne] ?? ligne);
  if (typeof a.archivee === 'boolean') parties.push(a.archivee ? 'archivage' : 'réactivation');
  const recherche = texte(a.recherche);
  if (recherche) parties.push(`« ${recherche} »`);
  const issue = texte(a.issue);
  if (issue) parties.push(issue);
  // Gestes sur l'assistante : les réglages changés, la version restaurée.
  if (a.changements && typeof a.changements === 'object') parties.push(Object.keys(a.changements).join(', '));
  const version = texte(a.versionId);
  if (version) parties.push(`version ${version}`);
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

export function JournalDesGestes({ lignes }: { lignes: LigneJournal[] }) {
  const [vue, setVue] = useState<Vue>('gestes');
  const [origine, setOrigine] = useState<Origine>('toutes');

  if (lignes.length === 0) {
    return (
      <EtatVide titre="Le journal est vide.">
        Les lectures et les gestes de Claude Code, et les gestes faits sur la page Assistante, apparaîtront ici, du plus récent au plus ancien.
      </EtatVide>
    );
  }

  const deLOrigine = origine === 'toutes' ? lignes : lignes.filter((l) => l.origine === origine);
  const gestes = deLOrigine.filter((l) => !estLecture(l.outil));
  const problemes = deLOrigine.filter(estProbleme);
  const visibles = vue === 'gestes' ? gestes : vue === 'problemes' ? problemes : deLOrigine;
  const parOrigine = (o: OrigineJournal) => lignes.filter((l) => l.origine === o).length;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Filtres libelle="Filtrer le journal">
          <Filtre actif={vue === 'gestes'} compte={gestes.length} onClick={() => setVue('gestes')}>
            Gestes
          </Filtre>
          <Filtre actif={vue === 'problemes'} compte={problemes.length} onClick={() => setVue('problemes')}>
            Refus et erreurs
          </Filtre>
          <Filtre actif={vue === 'tout'} compte={deLOrigine.length} onClick={() => setVue('tout')}>
            Tout
          </Filtre>
        </Filtres>
        <Filtres libelle="Origine" className="text-sm!">
          <Filtre actif={origine === 'toutes'} compte={lignes.length} onClick={() => setOrigine('toutes')}>
            Toutes origines
          </Filtre>
          <Filtre actif={origine === 'mcp'} compte={parOrigine('mcp')} onClick={() => setOrigine('mcp')}>
            {ORIGINES.mcp}
          </Filtre>
          <Filtre actif={origine === 'interface'} compte={parOrigine('interface')} onClick={() => setOrigine('interface')}>
            {ORIGINES.interface}
          </Filtre>
        </Filtres>
      </div>
      {visibles.length === 0 ? (
        <EtatVide
          forme="filtre"
          titre={
            deLOrigine.length === 0
              ? 'Aucune ligne de cette origine parmi les dernières.'
              : vue === 'gestes'
                ? `Aucun geste parmi ${deLOrigine.length > 1 ? `les ${deLOrigine.length} dernières lignes` : 'la dernière ligne'} : seulement des lectures.`
                : 'Aucun refus ni aucune erreur.'
          }
          action={
            <Action
              ton="normal"
              onClick={() => {
                setVue('tout');
                setOrigine('toutes');
              }}
            >
              Tout afficher
            </Action>
          }
        />
      ) : (
        <ListeDuJournal lignes={visibles} />
      )}
      <p className="text-sm text-encre-3">
        {lignes.length > 1 ? `Les ${lignes.length} dernières lignes du journal.` : 'La dernière ligne du journal.'} Ouvre une ligne pour voir ses arguments.
      </p>
    </div>
  );
}

/** Les lignes, sans filtre : le journal de Réglages, et les derniers gestes de la page Assistante. */
export function ListeDuJournal({ lignes }: { lignes: LigneJournal[] }) {
  return (
    <ol className="border-t border-filet">
      {lignes.map((l) => (
        <LigneDuJournal key={l.id} ligne={l} />
      ))}
    </ol>
  );
}

function LigneDuJournal({ ligne: l }: { ligne: LigneJournal }) {
  const libelle = libelleOutilMcp(l.outil);
  // Le résumé d'un succès (versions avant et après d'une poussée…) suit celui des arguments.
  const resume = [resumer(l.outil, l.arguments, l.noms), l.resultat === 'ok' && l.message ? masquer(l.message) : null].filter(Boolean).join(' · ');
  const r = resultat(l);
  const brut = masquer(JSON.stringify(l.arguments, null, 2));
  const question = l.resultat === 'confirmation-demandee' && l.message ? masquer(l.message) : null;
  return (
    <li className="border-b border-filet">
      <details className="group">
        <summary className="relative grid cursor-pointer list-none gap-x-4 gap-y-0.5 py-2 transition-colors duration-100 hover:bg-survol pointer-coarse:active:bg-survol max-sm:pr-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-11 sm:min-h-[38px] sm:grid-cols-[6.5rem_minmax(0,1fr)_auto_0.625rem] sm:items-baseline [&::-webkit-details-marker]:hidden">
          <span className="flex items-baseline gap-x-2 sm:flex-col sm:gap-y-0.5">
            <time dateTime={l.le.toISOString()} className="font-mono text-xs text-encre-3">
              {dateCourte(l.le)}
            </time>
            <span className={`text-xs ${l.origine === 'interface' ? 'text-encre-2' : 'text-encre-3'}`}>{ORIGINES[l.origine] ?? l.origine}</span>
          </span>
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
          {question ? (
            <>
              <p className="pt-1 text-xs text-encre-3">Question posée à l’opérateur</p>
              <pre className="rounded-md sm:max-h-64 sm:overflow-auto bg-surface px-3 py-2 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-encre-2">
                {question}
              </pre>
            </>
          ) : null}
        </div>
      </details>
      {/* Un refus de l'opérateur est déjà dit par le résultat : son message le répéterait. Une question : sa première ligne. */}
      {question ? (
        <p className="mb-2 line-clamp-2 text-sm break-words text-encre-3 sm:pl-[calc(6.5rem+1rem)]">{question.split('\n')[0]}</p>
      ) : l.message && l.resultat !== 'ok' && l.confirmation !== 'refusee' ? (
        <p className="pb-2 text-sm text-encre-3 sm:pl-[calc(6.5rem+1rem)]">{masquer(l.message)}</p>
      ) : null}
    </li>
  );
}
