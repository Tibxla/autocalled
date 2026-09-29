# Autocalled

Mini-SaaS de démonstration : une assistante vocale IA passe des appels de prospection au nom d'une entreprise, sur de vrais numéros de téléphone, puis en garde l'enregistrement et le bilan.

## Language

**Numéro autorisé** :
Numéro d'une personne qui a accepté d'être appelée par une IA et enregistrée. Tout appel vers un autre numéro est refusé.
_Avoid_ : whitelist, numéro de test

**Consentement** :
L'accord donné par une personne, avant tout appel, sur un texte versionné : être appelée par une IA et enregistrée. Il est attesté à l'import de la fiche et rend le numéro autorisé. La révocation le clôt pour de bon : un numéro révoqué ne se réautorise pas, et ses rappels à faire disparaissent.
_Avoid_ : opt-in, accord RGPD

**Opérateur** :
La seule personne qui se connecte au SaaS, configure les entreprises et lance les appels.
_Avoid_ : utilisateur, admin, client

**Entreprise** :
Le business que l'assistante représente pendant un appel : son offre, ses arguments, ses objections fréquentes. L'opérateur en configure plusieurs et en choisit une avant chaque appel.
_Avoid_ : client, business, compte, tenant

**Mode vitrine** :
Accès public en lecture seule aux appels déjà passés et à leurs bilans, sans possibilité d'en lancer.
_Avoid_ : démo publique, mode invité

**Prospect** :
Personne démarchée pour le compte d'une entreprise, décrite par une fiche durable (nom, société, rôle, contexte) qui accumule l'historique de ses appels. Appartient à une seule entreprise et sonne sur un numéro autorisé, que plusieurs prospects peuvent partager.
_Avoid_ : client, contact, lead, cible

**Prospect archivé** :
Prospect retiré des listes et des choix de campagne, qui n'est plus appelé tant qu'il l'est ; s'il attendait dans une file, il en est retiré. Ses appels, ses bilans et le consentement de son numéro restent, et la réactivation le fait revenir (dans aucune file). Un réimport de sa fiche ne le réactive pas.
_Avoid_ : supprimé, désactivé, masqué

**Effacement** :
La suppression, à la demande d'une personne, de tout ce qu'Autocalled garde d'elle : fiche, appels, transcriptions, bilans, enregistrements, rendez-vous, places en file, consentement et mentions au journal de Claude Code. Irréversible et confirmé. Seule reste l'empreinte de son numéro dans la liste d'opposition. Les autres prospects qui portent le même numéro ne sont pas effacés, mais ne sont plus appelables.
_Avoid_ : suppression, purge, anonymisation

**Liste d'opposition** :
Les empreintes irréversibles des numéros des personnes effacées : un numéro qui s'y trouve n'est plus jamais importé, autorisé ni composé. Elle ne contient aucun numéro en clair et ne se vide pas.
_Avoid_ : blacklist, liste noire, liste rouge

**Fiche prospect** :
Fichier Markdown d'un prospect : un en-tête (nom, société, rôle, numéro) et un contexte libre. Le nom du fichier identifie le prospect dans son entreprise ; le réimporter met la fiche à jour.
_Avoid_ : CSV, profil, contact

**Campagne** :
Une liste de prospects d'une même entreprise, appelés l'un après l'autre avec une même version de script ; un seul appel à la fois, chaque appel repartant du seul contexte de son prospect.
_Avoid_ : batch, séquence, vague, liste d'appels

**File** :
L'ordre dans lequel une campagne appelle ses prospects. Tant que la campagne n'est pas terminée, l'opérateur la modifie sans couper l'appel en cours : sauter un prospect le renvoie en fin de file, le retirer l'écarte de la campagne en gardant la trace, ajouter des prospects les place à la fin, terminer retire tous ceux qui restent et laisse l'appel en cours aller à son terme. Un prospect dont le numéro n'est plus autorisé au moment de son tour n'est pas appelé : il est « non autorisé ».
_Avoid_ : queue, liste d'attente, pile

**Appel** :
Une conversation téléphonique entre l'assistante et un prospect, lancée par l'opérateur.
_Avoid_ : call, conversation, session

**Assistante** :
L'agent vocal IA unique qui passe tous les appels, sous un nom choisi par l'opérateur (Mina par défaut), avec une personnalité et une voix fixes ; elle se présente comme l'assistante de l'entreprise représentée et parle comme une humaine. Chaque appel garde le nom sous lequel elle s'est présentée.
_Avoid_ : agent, bot, IA, voicebot

**Premier message** :
La phrase que l'assistante dit quand le prospect se tait au décroché (« Allô ? » par défaut). Réglé en base avec son nom, il vaut dès l'appel suivant ; quand le prospect parle le premier, c'est le prompt qui décide de la réponse.
_Avoid_ : accroche, message d'accueil, first message

**Configuration de l'assistante** :
Son prompt et ses réglages ElevenLabs (modèle, voix, tour de parole, relances de silence, durée maximale), versionnés dans `agent/` et envoyés à ElevenLabs par une poussée confirmée par l'opérateur ; chaque poussée par le serveur MCP est consignée, et chaque appel garde la version qui a parlé. Le nom et le premier message n'en font pas partie : ils vivent en base.
_Avoid_ : persona, paramètres de l'agent

**Objection** :
Réticence type d'un prospect envers une entreprise (« on a déjà un site », « c'est combien ? », « ça ne m'intéresse pas »), accompagnée de sa réponse CRAC. Appartient à une entreprise et garde une identité stable d'un appel à l'autre, pour qu'on puisse suivre si elle est levée.
_Avoid_ : blocage, frein

**CRAC** :
La méthode de traitement d'une objection en quatre temps : Creuser, Reformuler, Argumenter, Contrôler. Le bilan indique à quel temps une objection non levée a coincé.
_Avoid_ : traitement d'objection, rebond

**Refus ferme** :
Demande explicite du prospect d'arrêter (« au revoir », « ne me rappelez plus ») ; contrairement à une objection, elle n'est pas traitée : l'assistante conclut poliment et raccroche.
_Avoid_ : refus, non, rejet

**Script** :
La stratégie d'appel d'une entreprise, découpée en étapes ordonnées ; l'assistante s'en sert comme d'un plan, pas comme d'un texte à réciter. Il est versionné : le modifier crée une nouvelle version.
_Avoid_ : pitch, trame, playbook

**Étape** :
Un moment du script avec une intention propre (accroche, qualification, pitch, proposition de rendez-vous) et une ou deux formulations d'exemple. Pendant l'appel, l'assistante signale l'étape où elle se trouve, pour l'affichage seulement ; l'étape atteinte que retient le bilan fait foi.
_Avoid_ : phase, section, bloc

**Version de script** :
L'état figé d'un script à un instant donné. Chaque appel utilise exactement une version, choisie par l'opérateur.
_Avoid_ : variante, révision

## Issues et bilans

**Issue** :
Le résultat d'un appel, une seule par appel. Soit une issue système, soit une issue personnalisée.
_Avoid_ : résultat, statut, outcome, disposition

**Issue système** :
L'une des sept issues fixes dont dépend le comportement du produit : Rendez-vous pris, Rappel convenu, Envoi d'informations, Refus, Pas le bon interlocuteur, Interrompu, Non abouti.
_Avoid_ : issue par défaut, catégorie

**Issue personnalisée** :
Issue plus précise qu'une entreprise ajoute à sa liste, toujours rattachée à une issue système (« Demande une maquette » → Envoi d'informations).
_Avoid_ : sous-issue, tag

**Non abouti** :
Issue système d'un appel où aucune conversation n'a eu lieu (pas de réponse, messagerie, occupé) ; exclue des taux de conversion car elle ne dit rien du script.
_Avoid_ : échec, raté

**Rappel convenu** :
Issue système où le prospect demande à être rappelé à un moment précis ; la fiche du prospect affiche alors ce rappel à faire. Il reste à faire jusqu'au prochain appel vers ce prospect, qu'il décroche ou non ; un appel simulé ne compte pas.
_Avoid_ : relance, callback

**Rappel daté** :
Rappel convenu dont le bilan donne le jour, et l'heure ou le moment de la journée (matin, après-midi), tels que le prospect les a dits. Seule l'analyse le date, et on ne le corrige qu'en la relançant. L'accueil liste les rappels datés du jour et ceux en retard ; un rappel sans date reste « sans date ».
_Avoid_ : rappel programmé, tâche, échéance

**Bilan** :
Ce que l'analyse produit après un appel : l'issue, l'étape atteinte, les objections apparues ou levées, un résumé et des points forts et faibles.
_Avoid_ : récap, rapport, compte rendu, analyse

**Durée de conservation** :
Le temps pendant lequel un appel garde ce qu'a dit la personne : douze mois après son début, sauf réglage (`DUREE_CONSERVATION_MOIS`). Passé ce délai, l'appel est purgé la nuit suivante.
_Avoid_ : rétention, archivage

**Bilan purgé** :
Ce qui reste du bilan d'un appel passé la durée de conservation : l'issue, l'étape atteinte et les objections, levées ou non avec leur temps CRAC. Le résumé, les citations, les points forts et faibles et le rappel tel qu'il a été dit sont effacés, comme l'enregistrement et la transcription. Les chiffres de l'analyse ne changent pas, et l'appel ne se réanalyse plus. Une purge n'est pas un effacement : la fiche, le numéro et le consentement restent.
_Avoid_ : bilan archivé, bilan anonymisé, bilan effacé

## Agenda

**Rendez-vous** :
Premier échange réservé par l'assistante pendant un appel, dans le calendrier dédié, rattaché à l'appel et au prospect.
_Avoid_ : meeting, RDV, réunion, booking

**Créneau** :
Plage libre proposée au prospect, qui respecte les règles de rendez-vous de l'entreprise et n'entre en conflit avec aucun calendrier de l'opérateur.
_Avoid_ : slot, disponibilité, dispo

**Règles de rendez-vous** :
Contraintes d'une entreprise sur ses rendez-vous : durée, plages autorisées, délai minimum, horizon maximum.
_Avoid_ : paramètres agenda, config calendrier

## Téléphonie

**Ligne** :
Le chemin par lequel une conversation avec l'assistante a lieu ; le reste du produit ignore laquelle est utilisée. Chaque appel enregistre la sienne. Lignes : téléphone passerelle (Bluetooth), ligne navigateur, simulation ; Twilio en repli.
_Avoid_ : provider, trunk, canal

**Ligne navigateur** :
Ligne de test où l'opérateur parle à l'assistante depuis son navigateur, en jouant le prospect. Vraie conversation, vrai enregistrement, mais aucun téléphone ne sonne ; sert aussi de secours en démo.
_Avoid_ : widget, mode démo

**Appel simulé** :
Appel où un modèle de langage joue le prospect face à l'assistante, sans audio. Sert à produire du volume pour l'analyse ; toujours signalé comme tel et exclu des chiffres par défaut.
_Avoid_ : faux appel, test automatique

**Téléphone passerelle** :
Téléphone dédié, posé à côté du serveur et appairé en Bluetooth, qui compose les appels de l'assistante avec sa propre carte SIM.
_Avoid_ : modem, gateway, kit mains-libres

**Garde-fous** :
Les limites de la ligne téléphone, réglées par l'opérateur : appels par heure, appels par jour, pause entre deux appels. Un appel qui dépasserait un plafond ne part pas ; les desserrer demande une confirmation.
_Avoid_ : quota, rate limit, limites

**Prise de main** :
Pendant un appel téléphone, l'opérateur parle au prospect depuis son navigateur à la place de l'assistante, qui se tait jusqu'à la fin de l'appel.
_Avoid_ : takeover, transfert, reprise

## Pilotage par Claude Code

**Confirmation** :
L'accord que l'opérateur donne lui-même, sur une question rédigée par le serveur, avant un geste qui fait sonner un téléphone, révoque un numéro, efface une personne, envoie une invitation, desserre un garde-fou ou change ce que l'assistante dit au prospect. Le modèle ne peut pas y répondre à sa place. Les freins (raccrocher, suspendre, retirer de la file, terminer une campagne, resserrer un garde-fou, archiver un prospect) n'en demandent pas ; l'interface demande tout de même une confirmation en ligne avant de retirer un prospect ou de terminer une campagne, deux gestes qui ne se défont pas.
_Avoid_ : validation, approbation, consentement

**Journal de Claude Code** :
La trace de chaque appel d'outil du serveur MCP, lectures comprises, avec la réponse de l'opérateur quand une confirmation a été demandée. Il se lit dans Réglages.
_Avoid_ : logs, audit
