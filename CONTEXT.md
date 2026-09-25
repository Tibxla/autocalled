# Autocalled

Mini-SaaS de démonstration : une assistante vocale IA passe des appels de prospection au nom d'une entreprise, sur de vrais numéros de téléphone, puis en garde l'enregistrement et le bilan.

## Language

**Numéro autorisé** :
Numéro de téléphone qu'une personne consentante a enregistré pour recevoir les appels de l'assistante. Tout appel vers un autre numéro est refusé.
_Avoid_ : whitelist, numéro de test

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

**Appel** :
Une conversation téléphonique entre l'assistante et un prospect, lancée par l'opérateur.
_Avoid_ : call, conversation, session

**Assistante** :
L'agent vocal IA unique qui passe tous les appels, avec une personnalité et une voix fixes ; elle se présente toujours comme l'assistante IA de l'entreprise représentée.
_Avoid_ : agent, bot, IA, voicebot

**Objection** :
Réticence type d'un prospect envers une entreprise (« on a déjà un site », « c'est combien ? »), accompagnée de la réponse préparée. Appartient à une entreprise et garde une identité stable d'un appel à l'autre, pour qu'on puisse suivre si elle est levée.
_Avoid_ : blocage, frein, refus

**Script** :
La stratégie d'appel d'une entreprise, découpée en étapes ordonnées ; l'assistante s'en sert comme d'un plan, pas comme d'un texte à réciter. Il est versionné : le modifier crée une nouvelle version.
_Avoid_ : pitch, trame, playbook

**Étape** :
Un moment du script avec une intention propre (accroche, qualification, pitch, proposition de rendez-vous) et une ou deux formulations d'exemple.
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
Issue système où le prospect demande à être rappelé à un moment précis ; la fiche du prospect affiche alors ce rappel à faire.
_Avoid_ : relance, callback

**Bilan** :
Ce que l'analyse produit après un appel : l'issue, l'étape atteinte, les objections apparues ou levées, un résumé et des points forts et faibles.
_Avoid_ : récap, rapport, compte rendu, analyse

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
Le moyen par lequel un appel atteint le réseau téléphonique ; le reste du produit ignore laquelle est utilisée. Première ligne : un téléphone passerelle en Bluetooth ; en repli, un numéro Twilio.
_Avoid_ : provider, trunk, canal

**Téléphone passerelle** :
Téléphone dédié, posé à côté du serveur et appairé en Bluetooth, qui compose les appels de l'assistante avec sa propre carte SIM.
_Avoid_ : modem, gateway, kit mains-libres
