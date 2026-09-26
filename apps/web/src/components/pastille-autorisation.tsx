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
    <span className={`inline-flex items-center gap-2 text-sm ${ok ? 'text-encre' : 'text-encre-3'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${ok ? 'bg-encre' : 'shadow-[inset_0_0_0_1px_var(--encre-3)]'}`} />
      {LIBELLES[cle]}
    </span>
  );
}
