# Durée de conservation : après douze mois, un appel garde ses chiffres et perd ce qu'a dit la personne

Jusqu'ici, un appel gardait tout sans limite : l'enregistrement de l'application, le son et le journal du pont, la transcription, le bilan avec son résumé et ses citations. Seul l'effacement d'une personne (ADR 0013) les faisait partir. Le RGPD demande une durée de conservation limitée ; l'opérateur l'a fixée à douze mois, en gardant ce qui sert aux statistiques.

**Passé `DUREE_CONSERVATION_MOIS` après son début** (12 par défaut, 1 au moins, en mois de calendrier), un appel est **purgé** : ses enregistrements sont supprimés du disque (`enregistrements/<appel>.mp3`, `pont/<appel>.wav`, `pont/<appel>.log`, avec le même contrôle de chemin que l'effacement), sa transcription est vidée, son bilan réduit à ses champs structurés, le texte de son erreur effacé (une analyse refusée y recopie les citations du prospect), et l'adresse d'invitation de son rendez-vous aussi. La colonne `purge_le` le marque. Le bilan purgé garde l'issue, l'étape atteinte, les objections par identifiant avec leur levée et leur temps CRAC, et la date du rappel ; il perd le résumé, les citations, le libellé des objections nouvelles (écrit d'après la parole du prospect), les points forts et faibles et le rappel tel qu'il a été dit. L'analyse des versions ne lit que les champs gardés : ses chiffres ne bougent pas. Restent aussi sur l'appel la durée, les dates, la ligne, les versions de script, d'agent et d'analyseur, le numéro composé et le prospect.

Les lignes du **journal MCP** plus vieilles que la durée sont supprimées : elles recopient des arguments et des messages qui nomment des prospects. La **liste d'opposition** n'est jamais purgée : elle ne contient que des empreintes, et sa raison d'être est de durer.

La purge tourne chaque nuit (`autocalled-purge.timer`, qui lance `pnpm purger`). Elle est idempotente et travaille appel par appel : les fichiers d'abord, puis la base d'un bloc. Un appel dont un fichier résiste reste entier et sera repris le lendemain ; un appel marqué purgé n'a donc plus aucun fichier. Un appel dont l'analyse vient de repartir est reporté. `pnpm purger --essai` compte ce qui partirait, dans une transaction Postgres en lecture seule. Le compte rendu (journald) ne contient que des comptes, et les chemins relatifs des fichiers en échec.

Un appel purgé ne se réanalyse plus : la relance rapatrierait la conversation chez ElevenLabs et réécrirait ce qui vient d'être effacé. Le rapatriement et l'analyse n'écrivent jamais sur un appel purgé entre-temps. Sa page dit « Bilan purgé après 12 mois : détail effacé, issue et étapes conservées », avec l'issue, les étapes et les objections ; `lire_appel` rend `purgeLe` et `bilan.purge`, sans bloc de paroles de tiers.

## Considered Options

- Supprimer l'appel entier après douze mois : les taux de rendez-vous et l'étape médiane des anciennes versions changeraient, et la comparaison des versions de script perdrait son historique.
- Garder le texte du bilan et ne supprimer que le son et la transcription : le résumé et les citations recopient ce que la personne a dit ; c'est la même donnée, en plus court.
- Vider les champs du bilan en gardant sa forme (`resume: ''`) : chaque lecteur continuerait à afficher un résumé vide sans savoir pourquoi. Une forme distincte (`purge: true`) oblige le typage à traiter le cas partout.
- Purger aussi le numéro composé et le lien au prospect : l'identité de la personne a son propre cycle (fiche, archivage, effacement, ADR 0013). Tant que la fiche existe, son numéro y est de toute façon ; effacer la personne supprime ses appels, purgés ou non.
- Supprimer les conversations chez ElevenLabs : un appel d'écriture vers ElevenLabs que l'opérateur n'a pas demandé, comme pour l'effacement. Leur rétention se règle dans leur tableau de bord.
- Stocker la durée appliquée dans le bilan purgé : la mention l'affiche d'après le réglage du moment, plus simple ; changer la durée change la phrase des appels déjà purgés, pas leurs données.

## Consequences

- Migration 0015 : colonne `purge_le` des appels.
- `DUREE_CONSERVATION_MOIS` dans le `.env` (facultative). Une valeur illisible arrête la purge sans rien toucher ; elle ne descend jamais sous un mois.
- `scripts/installer-services.sh` installe et active le minuteur (chaque nuit à 4 h 30, un passage manqué est rattrapé au démarrage). Le service tourne dans la copie de production : c'est son dossier de données qu'il purge.
- Restent hors de portée : les conversations chez ElevenLabs, l'événement Google du rendez-vous (et l'adresse de l'invité qu'il porte), les sauvegardes Restic et journald jusqu'à leur rotation.
- Un bilan purgé ne se réanalyse pas et ne se cherche plus par son texte ; l'historique donné à l'assistante ne dit plus que l'issue de ces échanges.
