import { LIBELLES_ISSUES, type IssueSysteme } from '@autocalled/domain';
import Link from 'next/link';

const date = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

const LIGNES: Record<string, string> = { navigateur: 'navigateur', simulation: 'simulé', bluetooth: 'téléphone', twilio: 'téléphone' };

export interface LigneAppel {
  id: string;
  debutLe: Date;
  ligne: string;
  statut: string;
  issueSysteme: IssueSysteme | null;
  dureeSecondes: number | null;
  resume: string | null;
  prospect?: string;
}

function etat(a: LigneAppel): string {
  if (a.statut === 'en-cours') return 'En cours';
  if (a.statut === 'traitement') return 'Analyse…';
  if (a.statut === 'echec') return 'Analyse en échec';
  return a.issueSysteme ? LIBELLES_ISSUES[a.issueSysteme] : '—';
}

export function ListeAppels({ appels }: { appels: LigneAppel[] }) {
  return (
    <ul>
      {appels.map((a) => (
        <li key={a.id} className="border-b border-filet">
          <Link href={`/appels/${a.id}`} className="group grid gap-1 py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-6">
            <span className="font-mono text-sm text-encre-3">{date.format(a.debutLe)}</span>
            <span className="grid gap-0.5">
              <span className="font-medium group-hover:underline group-hover:decoration-filet-fort group-hover:underline-offset-4">
                {a.prospect ? `${a.prospect} · ` : ''}
                {etat(a)}
              </span>
              {a.resume ? <span className="truncate text-sm text-encre-2">{a.resume}</span> : null}
            </span>
            <span className="text-sm whitespace-nowrap text-encre-3">
              {LIGNES[a.ligne] ?? a.ligne}
              {a.dureeSecondes ? <span className="font-mono"> · {Math.floor(a.dureeSecondes / 60)}:{String(a.dureeSecondes % 60).padStart(2, '0')}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
