import type { Autorisation } from '@autocalled/domain';

const LIBELLES = {
  autorise: 'Autorisé',
  'consentement-revoque': 'Révoqué',
  'aucun-consentement': 'Sans consentement',
  'numero-invalide': 'Numéro invalide',
} as const;

export function PastilleAutorisation({ autorisation }: { autorisation: Autorisation | undefined }) {
  const cle = !autorisation ? 'aucun-consentement' : autorisation.autorise ? 'autorise' : autorisation.raison;
  const ok = cle === 'autorise';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${ok ? 'text-autorise' : 'text-encre-3'}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${ok ? 'bg-autorise' : 'bg-filet-fort'}`} />
      {LIBELLES[cle]}
    </span>
  );
}
