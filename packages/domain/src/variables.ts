/**
 * Les variables dynamiques injectées dans le prompt de l'assistante au début de chaque appel. L'assistante
 * est un agent unique : tout ce qu'elle sait d'elle-même (son nom), de l'entreprise et du prospect passe par ici.
 *
 * Un champ vide de la fiche de l'entreprise n'est pas transmis (ADR 0015) : sa variable part vide, car ElevenLabs
 * exige que toutes existent, et le prompt dit qu'une ligne sans rien après ses deux-points n'existe pas.
 */

export const VARIABLES_DE_L_APPEL = [
  'assistante_nom',
  'date_du_jour',
  'entreprise_nom',
  'entreprise_offre',
  'entreprise_cible',
  'entreprise_arguments',
  'entreprise_prix_consigne',
  'entreprise_interdits',
  'entreprise_complements',
  'prospect_nom',
  'prospect_role',
  'prospect_societe',
  'prospect_contexte',
  'prospect_email',
  'situation_appel',
  'rendez_vous',
  'historique_appels',
  'script_etapes',
  'objections',
] as const;

export type VariablesDeLAppel = Record<(typeof VARIABLES_DE_L_APPEL)[number], string>;

export interface ContexteAppel {
  /** Le nom sous lequel l'assistante se présente, choisi par l'opérateur (Mina par défaut). */
  assistante: { nom: string };
  entreprise: {
    nom: string;
    offre: string;
    cible: string;
    arguments: string;
    prixConsigne: string;
    interdits: string;
    /** Informations complémentaires, texte libre que l'assistante n'emploie que si la conversation y mène. */
    complements: string;
  };
  prospect: { nom: string; role: string | null; societe: string | null; contexte: string; email: string | null };
  /** Avec qui le prospect aura sa visio, et combien de temps. */
  rendezVous: { interlocuteur: string; dureeMinutes: number };
  etapes: { intention: string; exemples: string[] }[];
  objections: { libelle: string; creuser: string; reformuler: string; argumenter: string; controler: string }[];
  /**
   * Qui appelle qui, en une phrase adressée à l'assistante : l'application la compose pour un appel entrant (le
   * prospect rappelle). Absente : un appel sortant, « Tu as appelé {prospect}, qui ne t'attendait pas. »
   */
  situation?: string;
  /** Appels précédents avec ce prospect, dans n'importe quel ordre. */
  historique: { le: Date; issue: string; resume: string }[];
  maintenant: Date;
  fuseau?: string;
}

const ou = (texte: string, sinon: string) => texte.trim() || sinon;

/**
 * Les variables qu'un script ou une objection peut citer (« Bonjour, ici {{assistante_nom}} ») : l'application les
 * remplace elle-même, car ElevenLabs ne relit pas les accolades à l'intérieur de la valeur d'une variable.
 */
export const VARIABLES_DANS_LE_SCRIPT = ['assistante_nom', 'entreprise_nom', 'prospect_nom', 'prospect_role', 'prospect_societe', 'rendez_vous', 'date_du_jour'] as const;

export function variablesDeLAppel(c: ContexteAppel): VariablesDeLAppel {
  const fuseau = c.fuseau ?? 'Europe/Paris';
  const jourComplet = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: fuseau });
  const jourCourt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuseau });

  const simples: Record<(typeof VARIABLES_DANS_LE_SCRIPT)[number], string> = {
    assistante_nom: c.assistante.nom,
    date_du_jour: jourComplet.format(c.maintenant),
    entreprise_nom: c.entreprise.nom,
    prospect_nom: c.prospect.nom,
    prospect_role: c.prospect.role ?? 'responsable',
    prospect_societe: c.prospect.societe ?? 'son entreprise',
    rendez_vous: `une visio de ${c.rendezVous.dureeMinutes} minutes avec ${ou(c.rendezVous.interlocuteur, 'un membre de l’équipe')}`,
  };
  // Une variable inconnue reste telle quelle : l'éditeur la montre, rien ne l'invente.
  const remplir = (texte: string) =>
    texte.replace(/\{\{\s*(\w+)\s*\}\}/g, (tout, nom: string) => (Object.hasOwn(simples, nom) ? simples[nom as keyof typeof simples] : tout));

  const etapes = c.etapes
    .map((e, i) => {
      const exemples = e.exemples.length ? ` (par exemple : ${e.exemples.map((x) => `« ${remplir(x)} »`).join(' ; ')})` : '';
      return `${i + 1}. ${remplir(e.intention)}${exemples}`;
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
        .map(([nom, texte]) => `${nom} : ${remplir(texte.trim())}`);
      return temps.length ? `${o.libelle} : ${temps.join(' ; ')}` : o.libelle;
    })
    .join('\n');

  const historique = [...c.historique]
    .sort((a, b) => a.le.getTime() - b.le.getTime())
    .map((h) => `Le ${jourCourt.format(h.le)} : ${h.issue}.${h.resume ? ` ${h.resume}` : ''}`)
    .join('\n');

  return {
    ...simples,
    // Vides, ils le restent : aucun texte par défaut ne parle à la place de l'opérateur.
    entreprise_offre: c.entreprise.offre.trim(),
    entreprise_cible: c.entreprise.cible.trim(),
    entreprise_arguments: c.entreprise.arguments.trim(),
    entreprise_prix_consigne: c.entreprise.prixConsigne.trim(),
    entreprise_interdits: c.entreprise.interdits.trim(),
    entreprise_complements: c.entreprise.complements.trim(),
    prospect_contexte: ou(c.prospect.contexte, 'Rien de plus.'),
    prospect_email: c.prospect.email ?? 'inconnu, à demander',
    situation_appel: c.situation?.trim() || `Tu as appelé ${c.prospect.nom}, qui ne t'attendait pas.`,
    historique_appels: historique || 'Aucun échange précédent.',
    script_etapes: etapes || '1. Obtenir un premier rendez-vous.',
    objections: objections || 'Aucune objection préparée : applique la méthode CRAC.',
  };
}
