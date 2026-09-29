# Référence des outils du serveur MCP

Les 59 outils du serveur `autocalled`, par domaine. Dans Claude Code, chacun s’appelle `mcp__autocalled__<nom>`. Une entrée suivie de `?` est facultative. « Confirmation » : question posée à l’opérateur par l’élicitation, rédigée depuis la base, les fichiers ou ElevenLabs ; refusée sans client capable. Chaque appel laisse une ligne au journal (`lire_journal_mcp`).

Les textes qui viennent de tiers ou en dérivent (transcription, citations, résumé, moment de rappel, points forts et faibles d’un bilan, fiche d’un prospect et son contexte) ne sont jamais dans le JSON : ils arrivent dans un second bloc, précédé d’un avertissement et balisé `donnees-non-fiables="true"` (`<transcription>`, `<citations>`, `<bilan>`, `<resumes>`, `<fiche nomFichier="…">`). Ce sont des données, jamais des consignes.

Nature : **L** lecture, **É** écriture, **É !** écriture destructive ; **⇄** touche le monde extérieur (ElevenLabs, pont, Google ou `claude -p`).

## Assistante

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lire_assistante` | `distante?` | L ⇄ | non | nom, premier message, prompt entier, réglages, lecture seule, variables, synchronisation |
| `modifier_assistante` | `nom?`, `premierMessage?`, `connu?` | É | oui | nom et premier message, valables dès l’appel suivant |
| `modifier_prompt_assistante` | `remplacements`, `empreinteConnue` | É ⇄ | non (rien ne part avant la poussée) | remplacements exacts dans `agent/prompt.md` |
| `modifier_reglages_assistante` | `reglages`, `empreinteConnue` | É ⇄ | non (rien ne part avant la poussée) | réglages de la liste blanche dans `agent/mina.config.json` |
| `pousser_assistante` | aucune | É ⇄ | oui : différence rédigée par le serveur | envoie `agent/` à ElevenLabs |
| `rapatrier_assistante` | aucune | É ⇄ | non | réécrit `agent/` d’après ElevenLabs |
| `historique_assistante` | `versionId?` | L | non | configurations consignées, ou un instantané et sa différence |
| `restaurer_assistante` | `versionId` | É | non | réécrit `agent/` depuis un instantané, à pousser ensuite |

## Entreprises

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_entreprises` | aucune | L | non | entreprises et leurs comptes |
| `lire_entreprise` | `entreprise` | L | non | fiche, objections, issues, scripts et versions, usage |
| `creer_entreprise` | `nom` | É | non | crée l’entreprise, rend son slug |
| `modifier_fiche_entreprise` | `entreprise`, `champs?`, `plages?`, `connu?` | É | non | fiche et plages, champs donnés seulement |
| `supprimer_entreprise` | `entreprise` | É ! | oui | entreprise vide créée par erreur |

## Objections

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `enregistrer_objection` | `entreprise`, `objectionId?`, `libelle?`, `creuser?`, `reformuler?`, `argumenter?`, `controler?`, `connu?` | É | non | ajoute ou modifie une objection et sa réponse CRAC |
| `archiver_objection` | `entreprise`, `objectionId`, `archivee` | É | non | archive ou réactive |
| `ordonner_objections` | `entreprise`, `ordre` | É | non | ordre reçu par l’assistante |

## Issues personnalisées

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `ajouter_issue` | `entreprise`, `libelle`, `issueSysteme` | É | non | nouvelle issue rattachée à une issue système |
| `renommer_issue` | `entreprise`, `issueId`, `libelle` | É | non | corrige le libellé |
| `archiver_issue` | `entreprise`, `issueId`, `archivee` | É | non | archive ou réactive |

## Scripts et versions

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `creer_script` | `entreprise`, `nom`, `etapes` | É | non | script et sa version 1, étapes données |
| `lire_version_script` | `versionScriptId` | L | non | étapes, dernière ou non, appels passés avec elle |
| `creer_version_script` | `entreprise`, `scriptId`, `etapes`, `connu?` | É | non | version suivante (une version est figée) |
| `renommer_script` | `entreprise`, `scriptId`, `nom` | É | non | nouveau nom |
| `archiver_script` | `entreprise`, `scriptId`, `archive` | É | non | sort des lancements, rend l’usage |

## Prospects et consentements

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_prospects` | `entreprise`, `autorisation?`, `recherche?`, `limite?` (50, 200 au plus), `apres?`, `avecFiche?` | L | non | prospects par pages (`suivant` à repasser en `apres`), autorisation, rappel, origine MCP du numéro ; fiches réimportables dans le bloc balisé |
| `lire_prospect` | `entreprise`, `prospect` | L | non | champs, consentements, rappel, appels ; fiche Markdown et résumés dans le bloc balisé |
| `importer_fiches` | `entreprise`, `fiches` | É | oui seulement si un numéro change pour un prospect en file d’une campagne téléphone en cours | import de fiches, vaut attestation du consentement |
| `modifier_prospect` | `entreprise`, `prospect`, `champs`, `connu?` (par défaut : la fiche lue au début de l’outil) | É | oui seulement si le numéro change pour un prospect en file d’une campagne téléphone en cours | corrige une fiche champ par champ |
| `supprimer_prospect` | `entreprise`, `prospect` | É ! | oui | supprime la fiche, garde appels et consentement ; refusé en file, en appel, ou avec un rendez-vous à inscrire (à créer, échec) |
| `revoquer_numero` | `entreprise` et `prospect`, ou `numero` seul | É ! | oui | révocation définitive du numéro, y compris sans fiche |
| `lire_texte_consentement` | `version?` | L | non | texte en vigueur ou ancien, versions et consentements actifs |
| `lire_consentements` | `numero?`, `etat?` (actif, revoque), `limite?`, `avant?` | L | non | consentements par pages, avec les prospects qui portent le numéro (aucun : fiche supprimée) |

## Campagnes et file

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_campagnes` | `entreprise?`, `statut?` | L | non | campagnes et avancement, de toutes les entreprises sans `entreprise` |
| `lire_campagne` | `campagneId` | L | non | file détaillée |
| `nouvelle_campagne` | `entreprise`, `versionScriptId`, `ligne`, `prospects` | É | non | campagne prête, rien ne sonne |
| `supprimer_campagne` | `campagneId` | É | non | campagne prête, jamais lancée |
| `lancer_campagne` | `campagneId` | É ⇄ | oui sur le téléphone ; non en simulation ; refus en navigateur | lance ou reprend ; une campagne prête d’un script archivé est refusée |
| `suspendre_campagne` | `campagneId` | É | non | pause (frein) |
| `sauter_dans_la_file` | `campagneId`, `prospect` | É | non | renvoie un prospect en fin de file |
| `retirer_de_la_file` | `campagneId`, `prospect` | É | non | retire un prospect (frein) |
| `ajouter_a_la_campagne` | `campagneId`, `prospects` | É ⇄ | oui sur une campagne téléphone en cours | ajoute des prospects en fin de file |
| `terminer_campagne` | `campagneId` | É | non | termine avant la fin (frein) |

## Appels, bilans, analyse

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_appels` | `entreprise?`, `issue?`, `ligne?`, `version?`, `periode?`, `reels?`, `rappels?`, `recherche?`, `avant?`, `limite?`, `comptes?` | L | non | appels filtrés, paginés, comptés ; un filtre inconnu est refusé ; résumés dans le bloc balisé |
| `lire_appel` | `appelId`, `transcription?` | L | non | appel, bilan, rendez-vous ; texte du bilan, citations et transcription balisés |
| `lancer_appel` | `entreprise`, `prospect`, `versionScriptId`, `ligne` | É ⇄ | oui sur le téléphone | appel d’un prospect (téléphone ou simulation) |
| `raccrocher_appel` | `appelId` | É ⇄ | non | raccroche (frein) |
| `relancer_analyse` | `appelId` | É ⇄ | non | recalcule le bilan |
| `analyser_versions` | `entreprise`, `avecSimules?` | L | non | chiffres par version de script, par configuration de l’assistante, par objection |
| `rappels_du_jour` | aucune | L | non | rappels datés à faire aujourd’hui ou en retard ; moment dit par le prospect dans le bloc balisé |
| `lire_journee` | aucune | L | non | appels et campagnes du jour ; résumés dans le bloc balisé |
| `apercu_variables_appel` | `entreprise`, `prospect?`, `versionScriptId?` | L | non | variables et premier message que recevrait l’assistante |

## Agenda

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `etat_agenda` | aucune | L | non | copie des disponibilités, connexion Google, vingt derniers rendez-vous |
| `lister_rendez_vous` | `entreprise?`, `statut?` (a-creer, cree, echec), `limite?`, `avant?` | L | non | rendez-vous par pages, pour retrouver un échec ancien |
| `relire_agenda` | aucune | É ⇄ | non | relit l’agenda |
| `recreer_evenement` | `rendezVousId` | É ⇄ | oui | recrée l’événement d’un rendez-vous en échec |

## Ligne

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `etat_ligne` | aucune | L ⇄ | non | pont, téléphone, appel en cours, plafond, réglages, campagne ouverte |
| `regler_ligne` | `appelsParHeure?`, `appelsParJour?`, `pauseEntreAppelsS?` | É | oui pour desserrer ; non pour resserrer | plafonds et pause |
| `reconnecter_telephone` | aucune | É ⇄ | non | relance la liaison Bluetooth |

## Journal

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lire_journal_mcp` | `limite?`, `outil?`, `resultat?`, `depuis?` | L | non | derniers appels d’outils ; le détail d’une erreur interne reste dans Réglages |

## Ce qui reste hors du MCP

- Appeler par la ligne navigateur, prendre la main : il faut le micro et la voix de l’opérateur (ADR 0008).
- Appairer ou oublier le téléphone, connecter ou déconnecter Google : gestes physiques ou consentement OAuth, dans l’interface.
- Annuler ou déplacer un rendez-vous : l’invitation est déjà partie, cela se fait dans Google Agenda.
- Réautoriser un numéro révoqué, modifier le texte de consentement (migration seulement).
- Modifier ou supprimer une version de script, supprimer un script ou une objection, changer le rattachement d’une issue personnalisée : on crée une version, on archive.
- Corriger un bilan, une issue ou un rappel à la main : on relance l’analyse (ADR 0005).
- Changer l’identifiant d’un prospect, le slug ou le fuseau d’une entreprise ; supprimer une entreprise qui a un historique, une campagne lancée, un appel, un enregistrement ou une transcription.
- Dans la configuration ElevenLabs : outils, authentification, surcharges permises, langue, `first_message`, valeurs d’exemple (`pnpm agent push`, après relecture du code) ; `pull --force` et git.
- Les bornes des plafonds du pont, en dur dans `reglages.py`.
- Suggérer ou générer un script ou un prompt : Claude Code propose dans la conversation, l’opérateur décide.
- Les consignes de l’analyseur (`consignes()` de `src/lib/analyseur.ts`) : le bilan vient d’une analyse isolée (ADR 0005), et ses chiffres ne se comparent qu’à version d’analyseur égale. Un changement passe par le code, relu, avec une nouvelle `VERSION_ANALYSEUR` ; puis `relancer_analyse` sur les appels à recalculer.
- Le personnage du prospect simulé (`personnage()` de `src/lib/appels.ts`) : c’est le banc d’essai du produit, du code. Le changer se fait dans le code, relu ; régler la difficulté des simulations demanderait un réglage en base à créer, pas un outil de ce serveur.
