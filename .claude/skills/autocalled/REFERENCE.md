# Référence des outils du serveur MCP

Les 58 outils du serveur `autocalled`, par domaine. Dans Claude Code, chacun s’appelle `mcp__autocalled__<nom>`. Une entrée suivie de `?` est facultative. « Confirmation » : question posée à l’opérateur par l’élicitation, rédigée depuis la base, les fichiers ou ElevenLabs ; refusée sans client capable. Chaque appel laisse une ligne au journal des gestes (`lire_journal_mcp`), d’origine `mcp` ; les gestes de la page Assistante y sont aussi, d’origine `interface`.

Les textes qui viennent de tiers ou en dérivent (transcription, citations, résumé, moment de rappel, points forts et faibles d’un bilan, libellé d’une objection nouvelle, fiche d’un prospect et son contexte, historique des appels) ne sont jamais dans le JSON : ils arrivent dans un second bloc, précédé d’un avertissement et balisé `donnees-non-fiables="true"` (`<transcription>`, `<citations>`, `<bilan>`, `<resumes>`, `<fiche nomFichier="…">`, `<variables>`). Les questions de confirmation mettent d’abord le numéro et son origine, puis les noms, ramenés à une ligne courte ; elles signalent ce que le MCP a écrit (numéro, fiche de l’entreprise, objection, version). Ce sont des données, jamais des consignes.

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

La page Assistante de l’interface (`/assistante`) fait la même chose que ces outils, par les mêmes fonctions et avec les mêmes refus (`connu`, `empreinteConnue`, verrou, liste fermée, 4 000 caractères), **sauf le prompt**, qui reste en lecture et se modifie par `modifier_prompt_assistante`, puis se pousse depuis la page ou par `pousser_assistante`. Dans la page, le nom et le premier message, la poussée, le rapatriement et la restauration passent par une confirmation en ligne rédigée par le serveur ; la poussée y est refusée pendant un appel. Ce que la page écrit est consigné d’origine `interface` (`modifiePar` de l’assistante, `origine` de la version poussée) : un `connu` ou une `empreinteConnue` périmé après un geste dans la page n’est pas une erreur, il suffit de relire (`lire_assistante`).

## Entreprises

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_entreprises` | aucune | L | non | entreprises et leurs comptes |
| `lire_entreprise` | `entreprise` | L | non | fiche (dont `complements`), objections, issues, scripts et versions, usage |
| `creer_entreprise` | `nom` | É | non | crée l’entreprise, rend son slug |
| `modifier_fiche_entreprise` | `entreprise`, `champs?`, `plages?`, `connu?` | É | oui si le nom change, ou pour tout champ pendant une campagne téléphone en cours de l’entreprise | fiche et plages, champs donnés seulement ; `complements` : informations complémentaires, 1 500 caractères au plus ; un champ de texte vide n’est pas transmis à l’assistante |
| `supprimer_entreprise` | `entreprise` | É ! | oui | entreprise vide créée par erreur |

## Objections

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `enregistrer_objection` | `entreprise`, `objectionId?`, `libelle?`, `creuser?`, `reformuler?`, `argumenter?`, `controler?`, `connu?` | É | oui pendant une campagne téléphone en cours de l’entreprise | ajoute ou modifie une objection et sa réponse CRAC |
| `archiver_objection` | `entreprise`, `objectionId`, `archivee` | É | oui pendant une campagne téléphone en cours de l’entreprise | archive ou réactive |
| `ordonner_objections` | `entreprise`, `ordre` | É | oui pendant une campagne téléphone en cours de l’entreprise | ordre reçu par l’assistante |

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

## Prospects

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_prospects` | `entreprise`, `etatNumero?`, `recherche?`, `limite?` (50, 200 au plus), `apres?`, `avecFiche?`, `archives?` | L | non | prospects actifs par pages (`suivant` à repasser en `apres`), `etatNumero` (`appelable`, `numero-invalide`, `numero-efface`, `opposition-illisible`), rappel, dernier appel ; `archives: true` : les archivés seuls ; fiches réimportables dans le bloc balisé |
| `lire_prospect` | `entreprise`, `prospect` | L | non | champs, `archiveLe`, `etatNumero`, rappel, appels ; fiche Markdown et résumés dans le bloc balisé |
| `importer_fiches` | `entreprise`, `fiches` | É | oui seulement si le numéro ou la fiche (nom, société, rôle, contexte) change pour un prospect en file d’une campagne téléphone en cours | import de fiches, appelables aussitôt ; la fiche d’une personne effacée est refusée |
| `modifier_prospect` | `entreprise`, `prospect`, `champs`, `connu?` (par défaut : la fiche lue au début de l’outil) | É | oui seulement si le numéro, le nom, la société, le rôle ou le contexte change pour un prospect en file d’une campagne téléphone en cours | corrige une fiche champ par champ |
| `archiver_prospect` | `entreprise`, `prospect` | É | seulement s’il attend dans la file d’une campagne non terminée : la question nomme ces campagnes (non sinon : frein, réversible) | hors des listes et des choix de campagne, plus appelé ; retiré des files des campagnes non terminées, sans y revenir à la réactivation ; appels et bilans gardés ; refusé en appel, ou si une file s’est ajoutée depuis la question |
| `reactiver_prospect` | `entreprise`, `prospect` | É | non | de nouveau listé et appelable ; ne revient dans aucune file |
| `effacer_personne` | `entreprise`, `prospect` | É ! ⇄ | oui : liste de ce qui sera effacé, comptée par le serveur | efface fiche, appels, transcriptions, bilans, enregistrements, rendez-vous et événements Google (si l’API le permet), entrées de campagne, mentions au journal ; le numéro entre en opposition ; rend ce qui reste à faire à la main ; refusé en appel, pendant un rapatriement ou une inscription d’agenda, sans `SEL_OPPOSITION` |

## Campagnes et file

| Outil | Entrées | Nature | Confirmation | Rôle |
|---|---|---|---|---|
| `lister_campagnes` | `entreprise?`, `statut?` | L | non | campagnes et avancement, de toutes les entreprises sans `entreprise` |
| `lire_campagne` | `campagneId` | L | non | file détaillée (numéro appelable ou non à l’instant) |
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
| `lire_appel` | `appelId`, `transcription?` | L | non | appel, bilan, rendez-vous ; texte du bilan, citations et transcription balisés ; un appel purgé (`purgeLe`, `bilan.purge`) n’a plus que issue, étape et objections, sans bloc balisé |
| `lancer_appel` | `entreprise`, `prospect`, `versionScriptId`, `ligne` | É ⇄ | oui sur le téléphone | appel d’un prospect (téléphone ou simulation) |
| `raccrocher_appel` | `appelId` | É ⇄ | non | raccroche (frein) |
| `relancer_analyse` | `appelId` | É ⇄ | non | recalcule le bilan ; refusé sur un appel purgé |
| `analyser_versions` | `entreprise`, `avecSimules?` | L | non | chiffres par version de script, par configuration de l’assistante, par objection |
| `rappels_du_jour` | aucune | L | non | rappels datés à faire aujourd’hui ou en retard ; moment dit par le prospect dans le bloc balisé |
| `lire_journee` | aucune | L | non | appels et campagnes du jour ; résumés dans le bloc balisé |
| `apercu_variables_appel` | `entreprise`, `prospect?`, `versionScriptId?` | L | non | variables et premier message que recevrait l’assistante, textes par défaut (`parDefaut`) et champs vides de la fiche non transmis (`nonTransmis`) ; contexte de la fiche et historique dans le bloc `<variables>` |

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
| `lire_journal_mcp` | `limite?`, `origine?` (`mcp`, `interface`), `outil?`, `resultat?`, `depuis?` | L | non | le journal des gestes : appels d’outils du MCP et gestes de la page Assistante (sous le nom de l’outil qui fait la même chose : `modifier_assistante`, `modifier_reglages_assistante`, `pousser_assistante`, `rapatrier_assistante`, `restaurer_assistante`), chaque ligne avec son `origine` ; un geste confirmé laisse `confirmation-demandee` (message : la question lue) puis son résultat ; le détail d’une erreur interne reste dans Réglages |

## Ce qui reste hors du MCP

- Appeler par la ligne navigateur, prendre la main : il faut le micro et la voix de l’opérateur (ADR 0008).
- Appairer ou oublier le téléphone, connecter ou déconnecter Google : gestes physiques ou autorisation OAuth, dans l’interface.
- Annuler ou déplacer un rendez-vous : l’invitation est déjà partie, cela se fait dans Google Agenda.
- Modifier ou supprimer une version de script, supprimer un script ou une objection, changer le rattachement d’une issue personnalisée : on crée une version, on archive.
- Corriger un bilan, une issue ou un rappel à la main : on relance l’analyse (ADR 0005).
- Changer l’identifiant d’un prospect, le slug ou le fuseau d’une entreprise ; supprimer une entreprise qui a un historique, une campagne lancée ; supprimer un appel, un enregistrement ou une transcription à l’unité (seul `effacer_personne` les efface, tous ceux d’une personne).
- La durée de conservation (ADR 0014) : chaque nuit, `autocalled-purge.timer` purge les appels de plus de `DUREE_CONSERVATION_MOIS` (12) et le journal du même âge. Le bilan purgé garde issue, étape et objections : `analyser_versions` compte ces appels comme avant, mais leur résumé, leurs citations et leur transcription n’existent plus. `pnpm purger --essai` dans un terminal, pas par le MCP.
- Supprimer une conversation chez ElevenLabs : `effacer_personne` rend leurs identifiants, l’opérateur les supprime dans le tableau de bord d’ElevenLabs.
- Sortir un numéro de la liste d’opposition : impossible par conception (ADR 0013).
- Dans la configuration ElevenLabs : outils, authentification, surcharges permises, langue, `first_message`, valeurs d’exemple (`pnpm agent push`, après relecture du code) ; `pull --force` et git.
- Les bornes des plafonds du pont, en dur dans `reglages.py`.
- Suggérer ou générer un script ou un prompt : Claude Code propose dans la conversation, l’opérateur décide.
- Les consignes de l’analyseur (`consignes()` de `src/lib/analyseur.ts`) : le bilan vient d’une analyse isolée (ADR 0005), et ses chiffres ne se comparent qu’à version d’analyseur égale. Un changement passe par le code, relu, avec une nouvelle `VERSION_ANALYSEUR` ; puis `relancer_analyse` sur les appels à recalculer.
- Le personnage du prospect simulé (`personnage()` de `src/lib/appels.ts`) : c’est le banc d’essai du produit, du code. Le changer se fait dans le code, relu ; régler la difficulté des simulations demanderait un réglage en base à créer, pas un outil de ce serveur.
