import type { Autorisation } from '@autocalled/domain';

const LIBELLES = {
  autorise: 'Autorisé',
  'consentement-revoque': 'Révoqué',
  'aucun-consentement': 'Sans consentement',
  'numero-invalide': 'Numéro invalide',
  'numero-efface': 'Effacé',
  'opposition-illisible': 'Opposition illisible',
} as const;

const COULEURS = {
  autorise: { texte: 'text-encre-2', trait: 'stroke-encre-2' },
  'aucun-consentement': { texte: 'text-encre-3', trait: 'stroke-trait' },
  'consentement-revoque': { texte: 'text-alerte', trait: 'stroke-alerte' },
  'numero-invalide': { texte: 'text-alerte', trait: 'stroke-alerte' },
  'numero-efface': { texte: 'text-alerte', trait: 'stroke-alerte' },
  'opposition-illisible': { texte: 'text-alerte', trait: 'stroke-alerte' },
} as const;

/** Trait de 8 px : plein si le numéro peut être appelé, interrompu sinon. Le cas normal ne crie pas. */
export function PastilleAutorisation({ autorisation }: { autorisation: Autorisation | undefined }) {
  const cle = !autorisation ? 'aucun-consentement' : autorisation.autorise ? 'autorise' : autorisation.raison;
  const { texte, trait } = COULEURS[cle];
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${texte}`}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="4" x2="8" y2="4" strokeWidth="1.5" strokeDasharray={cle === 'autorise' ? undefined : '3 2'} className={trait} />
      </svg>
      {LIBELLES[cle]}
    </span>
  );
}
