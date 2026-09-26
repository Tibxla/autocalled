/**
 * Les variables dynamiques injectées dans le prompt de Mina au début de chaque appel. L'assistante
 * est un agent unique : tout ce qu'elle sait de l'entreprise et du prospect passe par ici.
 */

export const VARIABLES_DE_L_APPEL = [
  'date_du_jour',
  'entreprise_nom',
  'entreprise_offre',
  'entreprise_cible',
  'entreprise_arguments',
  'entreprise_prix_consigne',
  'entreprise_interdits',
  'prospect_nom',
  'prospect_role',
  'prospect_societe',
  'prospect_contexte',
  'prospect_email',
  'rendez_vous',
  'historique_appels',
  'script_etapes',
  'objections',
] as const;

export type VariablesDeLAppel = Record<(typeof VARIABLES_DE_L_APPEL)[number], string>;

export interface ContexteAppel {
  entreprise: {
    nom: string;
    offre: string;
    cible: string;
    arguments: string;
    prixConsigne: string;
    interdits: string;
  };
  prospect: { nom: string; role: string | null; societe: string | null; contexte: string; email: string | null };
  /** Avec qui le prospect aura sa visio, et combien de temps. */
  rendezVous: { interlocuteur: string; dureeMinutes: number };
  etapes: { intention: string; exemples: string[] }[];
  objections: { libelle: string; creuser: string; reformuler: string; argumenter: string; controler: string }[];
  /** Appels précédents avec ce prospect, dans n'importe quel ordre. */
  historique: { le: Date; issue: string; resume: string }[];
  maintenant: Date;
  fuseau?: string;
}

const ou = (texte: string, sinon: string) => texte.trim() || sinon;

export function variablesDeLAppel(c: ContexteAppel): VariablesDeLAppel {
  const fuseau = c.fuseau ?? 'Europe/Paris';
  const jourComplet = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: fuseau });
  const jourCourt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuseau });

  const etapes = c.etapes
    .map((e, i) => {
      const exemples = e.exemples.length ? ` (par exemple : ${e.exemples.map((x) => `« ${x} »`).join(' ; ')})` : '';
      return `${i + 1}. ${e.intention}${exemples}`;
    })
    .join('\n');

  const objections = c.objections
    .map((o) => {
      const temps = (
        [
          ['creuser', o.creuser],
          ['reformuler', o.reformuler],
          ['argumenter', o.argumenter],
          ['contrôler', o.controler],
        ] as const
      )
        .filter(([, texte]) => texte.trim())
        .map(([nom, texte]) => `${nom} : ${texte.trim()}`);
      return temps.length ? `${o.libelle} : ${temps.join(' ; ')}` : o.libelle;
    })
    .join('\n');

  const historique = [...c.historique]
    .sort((a, b) => a.le.getTime() - b.le.getTime())
    .map((h) => `Le ${jourCourt.format(h.le)} : ${h.issue}. ${h.resume}`)
    .join('\n');

  return {
    date_du_jour: jourComplet.format(c.maintenant),
    entreprise_nom: c.entreprise.nom,
    entreprise_offre: ou(c.entreprise.offre, 'à présenter simplement.'),
    entreprise_cible: ou(c.entreprise.cible, 'les professionnels.'),
    entreprise_arguments: ou(c.entreprise.arguments, 'à tirer de la conversation.'),
    entreprise_prix_consigne: ou(c.entreprise.prixConsigne, 'pas de consigne particulière.'),
    entreprise_interdits: ou(c.entreprise.interdits, 'rien de particulier.'),
    prospect_nom: c.prospect.nom,
    prospect_role: c.prospect.role ?? 'responsable',
    prospect_societe: c.prospect.societe ?? 'son entreprise',
    prospect_contexte: ou(c.prospect.contexte, 'Rien de plus.'),
    prospect_email: c.prospect.email ?? 'inconnu, à demander',
    rendez_vous: `une visio de ${c.rendezVous.dureeMinutes} minutes avec ${ou(c.rendezVous.interlocuteur, 'un membre de l’équipe')}`,
    historique_appels: historique || 'Aucun échange précédent.',
    script_etapes: etapes || '1. Obtenir un premier rendez-vous.',
    objections: objections || 'Aucune objection préparée : applique la méthode CRAC.',
  };
}
