import { LienTexte } from '@/components/ui';
import type { RapportEffacement } from './actions';

const JOUR_HEURE = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Ce qu'un effacement a fait, puis ce qui reste à finir à la main (événements d'agenda hors de portée, conversations
 * chez ElevenLabs, fichiers en échec) et les autres prospects du même numéro. Message neutre : c'est un compte rendu,
 * pas une erreur ; ce qui reste à faire est dit en `encre`.
 */
export function RapportEffacementMessage({ rapport }: { rapport: RapportEffacement }) {
  const n = (cle: keyof RapportEffacement['efface']) => rapport.efface[cle] ?? 0;
  const fait = [
    'sa fiche',
    n('appels') ? `${pluriel(n('appels'), 'appel', 'appels')} (transcriptions et bilans compris)` : null,
    n('fichiers') ? pluriel(n('fichiers'), 'fichier d’enregistrement', 'fichiers d’enregistrement') : null,
    n('rendezVous') ? pluriel(n('rendezVous'), 'rendez-vous', 'rendez-vous') : null,
    n('evenements') ? pluriel(n('evenements'), 'événement Google Agenda', 'événements Google Agenda') : null,
    n('entreesCampagne') ? pluriel(n('entreesCampagne'), 'place en file de campagne', 'places en file de campagne') : null,
    n('consentements') ? 'le consentement de son numéro' : null,
    n('mentionsJournal') ? pluriel(n('mentionsJournal'), 'mention au journal de Claude Code', 'mentions au journal de Claude Code') : null,
  ].filter(Boolean);
  const aFaire = rapport.evenementsASupprimer.length + rapport.conversationsElevenLabs.length + rapport.fichiersEnEchec.length;

  return (
    <div role="status" className="grid gap-2 rounded-md bg-surface px-3.5 py-2.5 text-sm text-encre-2">
      <p>
        <span className="font-medium text-encre">Personne effacée.</span> Supprimés : {fait.join(', ')}. Seule l’empreinte de son numéro reste,
        dans la liste d’opposition : il ne sera plus jamais appelé ni importé.
      </p>
      {aFaire ? (
        <div className="grid gap-1 text-encre">
          <p className="font-medium">À finir à la main</p>
          <ul className="grid gap-0.5">
            {rapport.evenementsASupprimer.map((e) => (
              <li key={e.debut}>
                Événement du <span className="font-mono">{JOUR_HEURE.format(new Date(e.debut))}</span> à supprimer dans Google Agenda.
              </li>
            ))}
            {rapport.conversationsElevenLabs.length ? (
              <li>
                {pluriel(rapport.conversationsElevenLabs.length, 'conversation', 'conversations')} à supprimer dans le tableau de bord d’ElevenLabs :{' '}
                <span className="font-mono break-all text-encre-2">{rapport.conversationsElevenLabs.join(', ')}</span>
              </li>
            ) : null}
            {rapport.fichiersEnEchec.length ? (
              <li>
                Fichiers à supprimer dans le dossier de données : <span className="font-mono break-all text-encre-2">{rapport.fichiersEnEchec.join(', ')}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {rapport.autresPorteurs.length ? (
        <p>
          Le même numéro reste sur{' '}
          {rapport.autresPorteurs.map((a, i) => (
            <span key={`${a.entreprise}/${a.prospect}`}>
              {i > 0 ? ', ' : ''}
              <LienTexte href={`/entreprises/${a.entreprise}/prospects/${a.prospect}`} className="font-mono text-encre">
                {a.entreprise}/{a.prospect}
              </LienTexte>
            </span>
          ))}
          , désormais inappelable{rapport.autresPorteurs.length > 1 ? 's' : ''} : si c’est la même personne, efface{' '}
          {rapport.autresPorteurs.length > 1 ? 'ces fiches' : 'cette fiche'} aussi.
        </p>
      ) : null}
    </div>
  );
}
