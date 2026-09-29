'use client';

import { BandeAppel, type IdentiteAppel } from '@/components/bande-appel';

/**
 * Suivi en direct d'un appel sur la ligne téléphone, dans la fiche d'appel : une enveloppe de BandeAppel en
 * variante fiche (fil déplié). Écoute, prise de main, micro, raccrochage, confirmations, fil perdu et
 * raccourcis vivent dans la bande. La fiche la rend à la même place et avec la même clé pour les statuts
 * en-cours puis traitement : le fil reste affiché pendant le rapatriement.
 */
export function SuiviTelephone({
  appelId,
  statut = 'en-cours',
  debutLe,
  finLe,
  conversation = false,
  identite,
  libelleProspect,
}: {
  appelId: string;
  statut?: 'en-cours' | 'traitement';
  /** ISO : chrono « sonne depuis » et « depuis la composition ». */
  debutLe?: string;
  /** ISO : « terminé à 14:07 · analyse 0:23 ». */
  finLe?: string | null;
  /** Un identifiant de conversation existe : le rapatriement est possible si le fil se perd. */
  conversation?: boolean;
  identite?: IdentiteAppel;
  /** Prénom affiché dans le fil quand `identite` manque. */
  libelleProspect?: string;
}) {
  return (
    <BandeAppel
      appelId={appelId}
      variante="fiche"
      statut={statut}
      conversation={conversation}
      {...(debutLe ? { debutLe } : {})}
      {...(finLe !== undefined ? { finLe } : {})}
      {...(identite ? { identite } : {})}
      {...(libelleProspect ? { libelleProspect } : {})}
    />
  );
}
