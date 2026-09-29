/**
 * Le nom lisible de chaque outil du serveur MCP (ADR 0009), et s'il ne fait que lire : le journal de Réglages
 * s'en sert pour dire ce que Claude Code a fait. `lecture` suit l'annotation `readOnlyHint` de l'outil ; un test
 * (mcp/libelles.test.ts) échoue dès qu'un outil enregistré manque ici ou n'a pas la même nature.
 * Sans dépendance serveur : lu par un composant client.
 */
export const OUTILS_MCP: Readonly<Record<string, { libelle: string; lecture: boolean }>> = {
  // Assistante
  lire_assistante: { libelle: 'Assistante lue', lecture: true },
  historique_assistante: { libelle: 'Historique de l’assistante lu', lecture: true },
  modifier_assistante: { libelle: 'Nom ou premier message de l’assistante modifié', lecture: false },
  modifier_prompt_assistante: { libelle: 'Prompt de l’assistante modifié', lecture: false },
  modifier_reglages_assistante: { libelle: 'Réglages de l’assistante modifiés', lecture: false },
  pousser_assistante: { libelle: 'Configuration de l’assistante poussée', lecture: false },
  rapatrier_assistante: { libelle: 'Configuration de l’assistante rapatriée', lecture: false },
  restaurer_assistante: { libelle: 'Configuration de l’assistante restaurée', lecture: false },
  // Entreprises
  lister_entreprises: { libelle: 'Entreprises listées', lecture: true },
  lire_entreprise: { libelle: 'Entreprise lue', lecture: true },
  creer_entreprise: { libelle: 'Entreprise créée', lecture: false },
  modifier_fiche_entreprise: { libelle: 'Fiche d’entreprise modifiée', lecture: false },
  supprimer_entreprise: { libelle: 'Entreprise supprimée', lecture: false },
  // Objections et issues
  enregistrer_objection: { libelle: 'Objection enregistrée', lecture: false },
  archiver_objection: { libelle: 'Objection archivée', lecture: false },
  ordonner_objections: { libelle: 'Objections réordonnées', lecture: false },
  ajouter_issue: { libelle: 'Issue ajoutée', lecture: false },
  renommer_issue: { libelle: 'Issue renommée', lecture: false },
  archiver_issue: { libelle: 'Issue archivée', lecture: false },
  // Scripts
  creer_script: { libelle: 'Script créé', lecture: false },
  lire_version_script: { libelle: 'Version de script lue', lecture: true },
  creer_version_script: { libelle: 'Version de script créée', lecture: false },
  renommer_script: { libelle: 'Script renommé', lecture: false },
  archiver_script: { libelle: 'Script archivé', lecture: false },
  // Prospects et consentements
  lister_prospects: { libelle: 'Prospects listés', lecture: true },
  lire_prospect: { libelle: 'Prospect lu', lecture: true },
  importer_fiches: { libelle: 'Fiches importées', lecture: false },
  modifier_prospect: { libelle: 'Prospect modifié', lecture: false },
  supprimer_prospect: { libelle: 'Prospect supprimé', lecture: false },
  revoquer_numero: { libelle: 'Numéro révoqué', lecture: false },
  lire_texte_consentement: { libelle: 'Texte de consentement lu', lecture: true },
  lire_consentements: { libelle: 'Consentements lus', lecture: true },
  // Campagnes
  lister_campagnes: { libelle: 'Campagnes listées', lecture: true },
  lire_campagne: { libelle: 'Campagne lue', lecture: true },
  nouvelle_campagne: { libelle: 'Campagne créée', lecture: false },
  supprimer_campagne: { libelle: 'Campagne supprimée', lecture: false },
  lancer_campagne: { libelle: 'Campagne lancée', lecture: false },
  suspendre_campagne: { libelle: 'Campagne suspendue', lecture: false },
  sauter_dans_la_file: { libelle: 'Prospect repassé en fin de file', lecture: false },
  retirer_de_la_file: { libelle: 'Prospect retiré de la file', lecture: false },
  ajouter_a_la_campagne: { libelle: 'Prospects ajoutés à la campagne', lecture: false },
  terminer_campagne: { libelle: 'Campagne terminée', lecture: false },
  // Appels
  lister_appels: { libelle: 'Appels listés', lecture: true },
  lire_appel: { libelle: 'Appel lu', lecture: true },
  lancer_appel: { libelle: 'Appel lancé', lecture: false },
  raccrocher_appel: { libelle: 'Appel raccroché', lecture: false },
  relancer_analyse: { libelle: 'Analyse relancée', lecture: false },
  analyser_versions: { libelle: 'Versions comparées', lecture: true },
  rappels_du_jour: { libelle: 'Rappels du jour lus', lecture: true },
  lire_journee: { libelle: 'Journée lue', lecture: true },
  apercu_variables_appel: { libelle: 'Variables d’appel prévisualisées', lecture: true },
  // Agenda
  etat_agenda: { libelle: 'État de l’agenda lu', lecture: true },
  lister_rendez_vous: { libelle: 'Rendez-vous listés', lecture: true },
  relire_agenda: { libelle: 'Agenda relu', lecture: false },
  recreer_evenement: { libelle: 'Événement d’agenda recréé', lecture: false },
  // Ligne
  etat_ligne: { libelle: 'État de la ligne lu', lecture: true },
  regler_ligne: { libelle: 'Garde-fous réglés', lecture: false },
  reconnecter_telephone: { libelle: 'Téléphone reconnecté', lecture: false },
  // Journal
  lire_journal_mcp: { libelle: 'Journal MCP lu', lecture: true },
};

/** Un outil inconnu (ajouté depuis) compte comme un geste : mieux vaut le montrer que le noyer dans les lectures. */
export function estLectureMcp(outil: string): boolean {
  return OUTILS_MCP[outil]?.lecture ?? false;
}
