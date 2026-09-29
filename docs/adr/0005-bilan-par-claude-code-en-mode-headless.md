# Bilan produit par Claude Code en mode headless, pas par l'API

Le bilan d'un appel dépend de l'entreprise (objections, étapes du script, issues personnalisées) : l'analyse post-appel d'ElevenLabs, configurée une fois pour tout l'agent, ne peut pas le produire. Le backend l'obtient donc d'un LLM. On passe par `claude -p` (Claude Code en mode headless, sur l'abonnement de l'opérateur) plutôt que par l'API Anthropic, pour ne pas payer une facture API sur une démo personnelle. Ce choix ne vaut que pour une démo à opérateur unique : un vrai SaaS passerait par l'API.

## Consequences

- L'analyseur est une interface ; `claude -p` et l'API en sont deux implémentations interchangeables.
- La transcription contient la parole du prospect, donc une entrée non fiable : `claude -p` tourne sans aucun outil ni serveur MCP, dans un dossier vide propre à l'appel (0700, supprimé ensuite), sans reprise de session, sans aucun fichier de réglages (`--restricted` : ni crochets, ni mode de permission de l'opérateur) et en mode `dontAsk`.
- L'agenda sans API Google passe par le même `claude -p`, avec le connecteur Google Agenda de Claude : les connecteurs du compte y restent chargés, mais le mode `dontAsk` n'autorise que les outils d'agenda nommés, et le contexte d'une fiche n'entre jamais dans son prompt.
- La sortie JSON est validée par un schéma côté backend, avec une nouvelle tentative si elle est invalide.
- L'authentification passe par un jeton longue durée (`claude setup-token`) en variable d'environnement, jamais par le montage du dossier `~/.claude`.
- Chaque bilan enregistre la version de l'analyseur qui l'a produit ; un bilan peut être recalculé.
