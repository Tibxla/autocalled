# Les réglages des appels se pilotent depuis l’interface

L’opérateur souhaite régler le produit sans dépendre du serveur MCP. La page Assistante propose les catalogues officiels du compte ElevenLabs pour la voix, le modèle vocal et le modèle de langage, avec saisie libre de secours et conservation de la valeur actuelle. Un aperçu demandé explicitement synthétise un texte fictif fixe avec les paramètres sélectionnés. Il utilise les crédits du fournisseur, sans composer d’appel ni changer la configuration ; les expressions guidées par le prompt restent à évaluer en conversation.

Réglages expose le décroché automatique des appels entrants, leur accueil distinct et les jours et horaires des rappels convenus. Ces valeurs vivent dans `reglages_automatisation` (migration 0020), relues avant la décision de décrocher et à chaque réveil. Une empreinte et un verrou transactionnel empêchent un formulaire périmé d’écraser une autre modification, même à la première écriture. Les écritures des entrants et des rappels sont authentifiées, confirmées et consignées au journal des gestes.

Sans ligne enregistrée, les comportements existants restent : décroché des prospects connus et déjà appelés, accueil avec le nom de l’assistante ; rappels activés à partir de `RAPPELS_AUTOMATIQUES_DEPUIS`, tous les jours de 9 h à 19 h, heure de Paris. Lors d’une première activation depuis l’interface, l’instant courant devient la borne : les anciennes échéances restent manuelles. Une pause conserve cette borne ; sa reprise reprend les rappels éligibles encore en attente. Les horaires des campagnes restent de 9 h à 19 h indépendamment des horaires choisis pour les rappels.

Le diagnostic expose l’état du téléphone et des phrases techniques prédéfinies à partir du dernier entrant reconnu. Aucun numéro refusé n’est conservé, aucun journal brut ne part au navigateur. Une conversation ouverte ne prouve pas que le correspondant entendait l’assistante. La lecture du pont pour cette page est bornée à deux secondes.

Les cinq écarts entre gestes MCP et interface sont comblés : renommage d’une issue personnalisée, suppression confirmée d’une entreprise sans prospect ni historique, suppression confirmée d’une campagne prête jamais lancée, durée de rendez-vous de 15 à 120 minutes et plages à la minute. Les suppressions passent par les gardes de domaine existantes, relues transactionnellement.

Les secrets, l’authentification, les permissions des outils et les paramètres de transport restent des choix de déploiement et de code. La nouvelle interface ne les expose pas.
