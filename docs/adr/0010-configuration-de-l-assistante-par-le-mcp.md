# La configuration de l'assistante se règle aussi depuis Claude Code : deux régimes, une poussée sous confirmation

L'ADR 0009 laissait le prompt et la configuration de l'assistante hors du serveur MCP. L'opérateur veut que Claude Code règle tout, jusqu'au nom de l'assistante, à son prompt et à son premier message, en relisant les bilans. Autocalled lui-même ne propose et ne modifie jamais rien de son propre chef. Cet ADR amende l'ADR 0009 sur ce point.

La configuration de l'assistante suit deux régimes. Ce qui voyage avec chaque appel vit en base et vaut dès l'appel suivant, sans poussée : le nom, que le prompt reçoit par la variable `assistante_nom`, et le premier message, la phrase dite quand le prospect se tait au décroché (« Allô ? » par défaut), que l'application transmet au pont. Ce qui vit chez ElevenLabs reste dans `agent/`, se relit dans git et ne part que par une poussée : le prompt, le modèle, la voix, le tour de parole, les relances de silence, la durée maximale.

Le serveur MCP lit tout et écrit dans les deux régimes. Écrire dans `agent/` ne change rien aux appels. Seul `pousser_assistante` envoie la configuration à ElevenLabs, avec le verrou de `pnpm agent push` (refus si la configuration distante a changé depuis le dernier rapatriement), après l'accord de l'opérateur sur un diff que le serveur rédige lui-même, de la configuration distante vers les fichiers. Un diff de plus de 4 000 caractères ne se relit pas dans une question : la poussée se fait alors en ligne de commande, qui affiche le même diff et demande confirmation. Le MCP ne pousse que le prompt et les réglages qu'il sait écrire. Les outils de l'agent, son authentification, les surcharges permises et la langue changent par le code, relu, puis par `pnpm agent push`. Le `first_message` d'ElevenLabs reste vide : non vide, il parlerait par-dessus le « allô » du prospect.

Changer le nom ou le premier message demande aussi l'accord de l'opérateur : ils sont dits au prospect dès l'appel suivant, et un nom soufflé par une transcription permettrait d'usurper une identité. Chaque poussée garde un instantané (prompt, réglages, version ElevenLabs) dans `versions_assistante`, relié aux appels par leur version d'agent ; `restaurer_assistante` réécrit `agent/` depuis un instantané, à repousser ensuite. Chaque appel garde le nom sous lequel l'assistante s'est présentée.

Ce que l'assistante dit au prospect ne vient pas que d'`agent/` : la fiche de l'entreprise (dont son nom, sous lequel l'assistante se présente), ses objections et la fiche du prospect entrent dans les variables de chaque appel, relues à chaque composition. Changer le nom de l'entreprise demande donc toujours l'accord de l'opérateur, comme le nom de l'assistante. Et pendant une campagne téléphone en cours de l'entreprise, qui enchaîne les appels sans autre geste, toute écriture de ces textes le demande aussi : fiche de l'entreprise, objection ajoutée, modifiée, archivée ou réordonnée, fiche d'un prospect en file (nom, société, rôle, contexte, numéro), par correction ou par import. Les confirmations d'appel et de campagne signalent ce que le MCP a écrit (numéro, fiche de l'entreprise, objection, version du script), mettent le numéro avant les noms, et ramènent chaque champ de la base à une ligne courte (amendement de la livraison).

La liste des gestes soumis à l'élicitation s'allonge : pousser la configuration de l'assistante, changer son nom ou son premier message, ajouter des prospects à une campagne téléphone en cours, supprimer une fiche prospect ou une entreprise vide. L'empreinte gardée entre la question et la réponse est désormais signée (HMAC, clé tirée au démarrage du serveur, dix minutes, usage unique).

## Considered Options

- Le prompt en base, source de vérité : deux sources, la relecture dans git perdue, `pnpm agent` aveugle, et le test qui vérifie les variables du prompt ne voit plus rien.
- Écrire `agent/` par le MCP sans pouvoir pousser : l'opérateur finirait chaque réglage au terminal.
- Le nom dans `agent/` : chaque renommage exigerait une poussée, et ni l'interface, ni l'analyseur, ni les confirmations ne lisent ces fichiers.
- Le `first_message` d'ElevenLabs comme premier message : il parlerait aussi quand le prospect a déjà dit « allô », et doublerait l'ouverture.
- Une suggestion de script ou de prompt produite par Autocalled après l'analyse : écartée par l'opérateur. Les ajustements passent par Claude Code, dans la conversation, puis par l'opérateur.
- Les consignes de l'analyseur réglables par le MCP : le bilan vient d'une analyse isolée (ADR 0005), dont les chiffres ne se comparent qu'à version d'analyseur égale. Elles restent dans le code, relu, et tout changement porte une nouvelle `VERSION_ANALYSEUR`.
- Le personnage du prospect simulé réglable par le MCP : c'est le banc d'essai du produit, du code relu. Régler la difficulté des simulations demanderait un réglage en base, à créer le jour où l'opérateur le demande.

## Consequences

- Une nouvelle variable dans le prompt ne se pousse qu'après le déploiement de l'application qui l'envoie et le redémarrage du pont ; sinon ElevenLabs refuse d'ouvrir la conversation. Le MCP valide le prompt contre les variables du code de la copie où il tourne, pas contre celles de la production.
- Le MCP écrit dans l'arbre de travail de la copie où Claude Code est ouvert : `agent/` modifié reste à commiter, et le MCP ne lance jamais git.
- Le modèle qui lit une transcription a la main sur le prompt. La garde tient à l'élicitation au moment où quelque chose part (poussée, nom, premier message), à la validation (variables du prompt, section Règles, liste blanche), au journal, et à la règle qui fait de tout texte de tiers une donnée.
- Le texte de consentement v2 ne nomme plus l'assistante ; les consentements v1 gardent leur version.
- `pnpm agent push` montre le diff et demande confirmation : une écriture glissée dans `agent/` ne part plus à l'aveugle.
- Une version poussée puis remplacée par la ligne de commande seule n'est consignée que dans git.
- Une exception dans un outil ne renvoie plus son texte au modèle (ni message Postgres, ni chemin) : le détail va au journal MCP, avec l'accord de l'opérateur s'il avait été donné avant.
