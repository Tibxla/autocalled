import type { Autorisation } from '@autocalled/domain';
import { AjoutClaudeCode } from '@/components/ajout-claude-code';
import { estimation, type ReglagesLigne } from '@/components/garde-fous';
import { PastilleAutorisation } from '@/components/pastille-autorisation';

/**
 * Récapitulatif d'une campagne prête : il sert de confirmation. Il dit ce qui va se passer sur la ligne choisie,
 * montre les premiers prospects avec leur numéro masqué et leur autorisation relue au rendu, et, au téléphone,
 * les plafonds et le temps qu'il faudra au plus tôt. Vue pure : l'action finale vient de la régie.
 */

export interface ProspectRecapitulatif {
  rang: number;
  id: string;
  nom: string;
  societe: string | null;
  /** Déjà masqué par la page (« 06 •• •• •• 40 »). */
  numero: string;
  autorisation: Autorisation | undefined;
  /** Au téléphone : date d'entrée du numéro par le serveur MCP (ADR 0009), sinon null. */
  ajoutMcp?: Date | null;
}

const PHRASES = {
  bluetooth: 'Téléphone passerelle : ces numéros vont vraiment sonner.',
  navigateur: 'Ligne navigateur : tu joues chaque prospect, rien ne sonne.',
  simulation: 'Simulation : un modèle joue chaque prospect, sans audio.',
  twilio: 'Téléphone (Twilio) : ces numéros vont vraiment sonner.',
} as const;

const PREMIERS = 10;

/** « Plafond : 15 appels par heure, 50 par 24 heures ; 38 appels téléphone ces dernières 24 heures, d'après la base. » */
export function phrasePlafonds(reglages: ReglagesLigne | null, passes24h: number | null): string {
  if (!reglages) return 'Plafonds inconnus : la ligne n’a pas répondu. Le pont les appliquera quand même.';
  const passes =
    passes24h === null
      ? ''
      : ` ; ${passes24h} appel${passes24h > 1 ? 's' : ''} téléphone ces dernières 24 heures, d’après la base`;
  return `Plafond : ${reglages.appelsParHeure} appels par heure, ${reglages.appelsParJour} par 24 heures${passes}.`;
}

/** La phrase d'estimation des garde-fous, ou rien quand les réglages sont inconnus. */
export function phraseEstimation(appels: number, reglages: ReglagesLigne | null, passes24h: number | null): string | null {
  if (!reglages) return null;
  return estimation({ appels, reglages, ...(passes24h === null ? {} : { passes24h }) }).phrase;
}

function Ligne({ p }: { p: ProspectRecapitulatif }) {
  return (
    <li className="flex min-h-[38px] flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-filet py-1.5 sm:grid sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_10rem] sm:py-0">
      <span className="font-mono text-xs text-encre-3">{p.rang}</span>
      <span className="min-w-0 truncate max-sm:flex-1">
        <span className="font-medium">{p.nom}</span>
        {p.societe ? <span className="text-encre-3"> · {p.societe}</span> : null}
      </span>
      <span className="font-mono text-xs text-encre-3 max-sm:hidden">{p.numero}</span>
      <span className="max-sm:ml-auto sm:text-right">
        <PastilleAutorisation autorisation={p.autorisation} />
      </span>
      {p.ajoutMcp ? (
        <span className="basis-full pb-1.5 text-sm text-encre-3 sm:col-span-3 sm:col-start-2 sm:-mt-1.5">
          <AjoutClaudeCode le={p.ajoutMcp} />
        </span>
      ) : null}
    </li>
  );
}

export function Recapitulatif({
  ligne,
  prospects,
  autorises,
  reglages = null,
  passes24h = null,
  action,
}: {
  ligne: 'navigateur' | 'bluetooth' | 'simulation' | 'twilio';
  prospects: ProspectRecapitulatif[];
  autorises: number;
  reglages?: ReglagesLigne | null;
  passes24h?: number | null;
  action: React.ReactNode;
}) {
  const premiers = prospects.slice(0, PREMIERS);
  const suite = prospects.slice(PREMIERS);
  const sautes = prospects.length - autorises;
  const telephone = ligne === 'bluetooth';
  const estime = telephone ? phraseEstimation(autorises, reglages, passes24h) : null;
  const ajoutsMcp = prospects.filter((p) => p.ajoutMcp).length;

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <p className="text-lg font-medium text-balance">{PHRASES[ligne]}</p>
        <p className="text-md text-encre-2">
          <span className="font-mono">{prospects.length}</span> prospect{prospects.length > 1 ? 's' : ''}, appelés dans l’ordre alphabétique, un
          seul appel à la fois.
          {sautes > 0 ? (
            <>
              {' '}
              <span className="font-mono">{sautes}</span> ne ser{sautes > 1 ? 'ont' : 'a'} pas appelé{sautes > 1 ? 's' : ''} : numéro non autorisé.
            </>
          ) : null}
          {ajoutsMcp > 0 ? (
            <>
              {' '}
              {ajoutsMcp > 1 ? (
                <>
                  <span className="font-mono">{ajoutsMcp}</span> numéros ajoutés par Claude Code, signalés dans la liste.
                </>
              ) : (
                'Un numéro ajouté par Claude Code, signalé dans la liste.'
              )}
            </>
          ) : null}
        </p>
      </div>

      <div>
        <ol aria-label="Prospects de la campagne, dans l’ordre d’appel" className="border-t border-filet text-md">
          {premiers.map((p) => (
            <Ligne key={p.id} p={p} />
          ))}
        </ol>
        {suite.length > 0 ? (
          <details className="group">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 text-md text-encre-3 hover:text-encre-2 pointer-coarse:h-11 [&::-webkit-details-marker]:hidden">
              <span className="decoration-souligne underline-offset-4 group-hover:underline pointer-coarse:underline">
                <span className="group-open:hidden">
                  et <span className="font-mono">{suite.length}</span> autre{suite.length > 1 ? 's' : ''}
                </span>
                <span className="hidden group-open:inline">Replier la liste</span>
              </span>
            </summary>
            <ol aria-label="Suite de la campagne" className="text-md">
              {suite.map((p) => (
                <Ligne key={p.id} p={p} />
              ))}
            </ol>
          </details>
        ) : null}
      </div>

      {telephone ? (
        <div className="grid max-w-[68ch] gap-1 text-md text-encre-2">
          <p>{phrasePlafonds(reglages, passes24h)}</p>
          {estime ? <p>{estime}</p> : null}
        </div>
      ) : null}

      {action}
    </div>
  );
}
