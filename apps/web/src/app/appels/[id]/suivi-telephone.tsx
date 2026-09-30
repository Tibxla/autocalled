'use client';

import { BandeAppel, type IdentiteAppel } from '@/components/bande-appel';

/**
 * Suivi en direct d'un appel sur la ligne téléphone, dans la fiche d'appel : une enveloppe de BandeAppel en
 * variante fiche (fil déplié). Écoute, prise de main, micro, raccrochage, confirmations, fil perdu et
 * raccourcis vivent dans la bande ; sa version condensée se colle en haut quand les commandes sortent de
 * l'écran. La fiche la rend à la même place et avec la même clé pour les statuts en-cours puis traitement :
 * le fil reste affiché pendant le rapatriement.
 */
export function SuiviTelephone({
  appelId,
  statut = 'en-cours',
  debutLe,
  finLe,
  conversation = false,
  identite,
  libelleProspect,
  etapes,
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
  /** Intentions des étapes de la version de l'appel : libellé de l'étape signalée en direct. */
  etapes?: readonly string[];
}) {
  return (
    <BandeAppel
      appelId={appelId}
      variante="fiche"
      // Les commandes restent à portée quand le fil déplié les fait sortir de l'écran.
      condensee
      statut={statut}
      conversation={conversation}
      {...(debutLe ? { debutLe } : {})}
      {...(finLe !== undefined ? { finLe } : {})}
      {...(identite ? { identite } : {})}
      {...(libelleProspect ? { libelleProspect } : {})}
      {...(etapes ? { etapes } : {})}
    />
  );
}
