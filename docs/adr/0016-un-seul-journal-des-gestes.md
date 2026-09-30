# Un seul journal des gestes, avec leur origine

Depuis la livraison, la page Assistante fait ce que font les outils du MCP sur l'assistante, sauf le prompt (ADR 0010) : enregistrer le nom ou le premier message, enregistrer les réglages, pousser vers ElevenLabs, rapatrier, restaurer une version. Seul le serveur MCP écrivait au journal (ADR 0009). On savait donc qui avait poussé une version, par `versions_assistante`, mais pas quand l'opérateur avait cliqué « Restaurer » ni ce qu'il avait lu avant.

Il n'y a qu'un journal, le **journal des gestes**. La table `journal_mcp` porte aussi les gestes de l'interface, avec une colonne `origine` : `mcp` pour Claude Code (valeur par défaut, celle de toutes les lignes écrites avant la migration 0017), `interface` pour la page. La table garde son nom : la renommer toucherait la purge, l'effacement, l'outil `lire_journal_mcp` et les tests pour un gain de lecture seulement. Le schéma le dit en commentaire.

Un geste de la page s'écrit au format des lignes du MCP, par la même fonction (`lib/journal.ts`), sous le nom de l'outil qui fait la même chose (`modifier_assistante`, `modifier_reglages_assistante`, `pousser_assistante`, `rapatrier_assistante`, `restaurer_assistante`) : arguments utiles sans donnée personnelle (ancien et nouveau nom, réglages changés avec leur valeur avant et après, version poussée ou restaurée), résultat, raison d'un refus, détail d'une exception. Un geste confirmé dans la page laisse deux lignes, comme une élicitation : `confirmation-demandee`, dont le message est la question que l'opérateur a lue (relue par le serveur au moment de l'accord, coupée à 2 000 caractères), puis le résultat avec `confirmation: acceptee`. Sans la première ligne, le geste ne part pas. Les réglages, qui ne demandent pas de confirmation dans la page, laissent une ligne après l'écriture, comme un outil MCP sans confirmation.

## Considered Options

- Deux journaux, un par origine : deux purges, deux effacements, et deux endroits à lire pour savoir ce qui a changé l'assistante.
- Une colonne `question` et une seule ligne par geste : un format de plus, une colonne de plus à neutraliser à l'effacement, et un journal que `lire_journal_mcp` et Réglages lisent autrement selon l'origine.
- Journaliser la préparation (la question et la différence affichées) : ce n'est pas un geste, et « Annuler » ne laisse rien ; la ligne `confirmation-demandee` d'un geste de la page date donc l'accord, pas l'affichage.

## Consequences

- La purge à 12 mois (ADR 0014) et l'effacement d'une personne (ADR 0013) traitent la table entière, quelle que soit l'origine.
- `lire_journal_mcp` rend l'origine de chaque ligne et filtre par origine : Claude Code voit ce que l'opérateur a fait dans la page.
- Réglages montre le journal des gestes avec l'origine de chaque ligne et un filtre par origine ; la page Assistante, les cinq derniers gestes faits sur l'assistante, des deux origines, sans les lectures ni les questions.
- La question d'une poussée est relue chez ElevenLabs au moment de l'accord ; si la configuration a bougé depuis l'affichage, le geste est refusé sans question gardée.
