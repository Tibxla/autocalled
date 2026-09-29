/**
 * Garde-fous de la ligne téléphone (plafonds et pause entre deux appels) : validation, sens d'un
 * changement et estimation de la durée d'une campagne. Fonctions pures.
 */

export type ReglagesLigne = { appelsParHeure: number; appelsParJour: number; pauseEntreAppelsS: number };

/**
 * Copie des bornes de apps/pont/pont/reglages.py (appelsParHeure 1 à 60, appelsParJour 1 à 500,
 * pauseEntreAppelsS 5 à 600) : le pont reste seul juge, ceci ne sert qu'à prévenir avant l'envoi.
 */
export const BORNES: Record<keyof ReglagesLigne, [number, number]> = {
  appelsParHeure: [1, 60],
  appelsParJour: [1, 500],
  pauseEntreAppelsS: [5, 600],
};

export function validerReglages(r: ReglagesLigne): Partial<Record<keyof ReglagesLigne, string>> {
  const erreurs: Partial<Record<keyof ReglagesLigne, string>> = {};
  for (const cle of Object.keys(BORNES) as (keyof ReglagesLigne)[]) {
    const valeur = r[cle];
    const [min, max] = BORNES[cle];
    if (!Number.isInteger(valeur)) erreurs[cle] = 'Un nombre entier.';
    else if (valeur < min || valeur > max) erreurs[cle] = `Entre ${min} et ${max}.`;
  }
  if (!erreurs.appelsParHeure && !erreurs.appelsParJour && r.appelsParJour < r.appelsParHeure) {
    erreurs.appelsParJour = 'Le plafond par jour ne peut pas être inférieur au plafond par heure.';
  }
  return erreurs;
}

/** Vrai quand le changement laisse partir plus d'appels : hausse d'un plafond ou pause raccourcie. */
export function desserre(avant: ReglagesLigne, apres: ReglagesLigne): boolean {
  return (
    apres.appelsParHeure > avant.appelsParHeure ||
    apres.appelsParJour > avant.appelsParJour ||
    apres.pauseEntreAppelsS < avant.pauseEntreAppelsS
  );
}

/** « moins d'une minute », « 12 min », « 1 h 20 », « 6 h ». */
export function dureeLisible(minutes: number): string {
  if (minutes < 1) return 'moins d’une minute';
  const total = Math.ceil(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * Durée minimale avant que le dernier appel parte : le plafond horaire autorise H appels par heure glissante
 * et la pause sépare deux appels ; la durée des appels eux-mêmes n'est pas comptée, d'où « au plus tôt ».
 * `passes24h` (appels déjà passés sur 24 h, d'après la base) indique quand le plafond du jour arrêtera la ligne.
 */
export function estimation(p: { appels: number; reglages: ReglagesLigne; passes24h?: number }): {
  minutesAuPlusTot: number;
  phrase: string;
  arretApres: number | null;
} {
  const n = Math.max(0, Math.floor(p.appels));
  const { appelsParHeure: h, appelsParJour: j, pauseEntreAppelsS: pause } = p.reglages;
  const restant = Math.max(0, j - (p.passes24h ?? 0));
  const arretApres = n > restant ? restant : null;
  const fin =
    arretApres === null
      ? ''
      : ` Le plafond par jour arrêtera la ligne après ${arretApres} appel${arretApres > 1 ? 's' : ''}, d’après la base.`;

  if (n === 0) return { minutesAuPlusTot: 0, phrase: 'Aucun appel à passer.', arretApres: null };
  if (n === 1) return { minutesAuPlusTot: 0, phrase: `À ce rythme, cet appel peut partir tout de suite.${fin}`, arretApres };

  const minutesAuPlusTot = Math.max(Math.floor((n - 1) / h) * 60, ((n - 1) * pause) / 60);
  return {
    minutesAuPlusTot,
    phrase: `À ce rythme, le dernier des ${n} appels partira au plus tôt dans ${dureeLisible(minutesAuPlusTot)}.${fin}`,
    arretApres,
  };
}
