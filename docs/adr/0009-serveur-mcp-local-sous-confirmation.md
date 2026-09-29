# Piloter Autocalled depuis Claude Code : un serveur MCP local en stdio, sous confirmation de l'opérateur

Autocalled expose un serveur MCP (`apps/web/mcp/`), déclaré dans `.mcp.json` à la racine du dépôt et lancé en stdio par Claude Code sur le serveur. Il n'est jamais servi en HTTP : un connecteur claude.ai l'appellerait depuis Internet, ce que les ADR 0004 et 0006 excluent. Ses outils appellent les mêmes fonctions de `lib/` que les server actions de l'interface, validées par les mêmes schémas, et chaque appel d'outil laisse une ligne dans la table `journal_mcp`, lectures comprises (visible dans Réglages).

Le modèle qui lit une transcription d'appel lit la parole d'un tiers (ADR 0005), et il a aussi les outils qui appellent. Tout ce qui fait sonner le téléphone (appel, campagne), révoque un numéro, envoie une invitation à un prospect ou desserre les plafonds de la ligne demande donc une confirmation par élicitation : Claude Code pose la question à l'opérateur, le serveur la rédige depuis la base (prospect, numéro, script, heure, plafonds), et le modèle ne peut pas y répondre à sa place. Un client sans élicitation, comme `claude -p`, se voit refuser ces gestes. Les freins (raccrocher, suspendre une campagne, resserrer un plafond) passent sans confirmation.

Un import de fiches par le MCP vaut l'import de l'interface case cochée : l'opérateur atteste le consentement des personnes quand il le demande à Claude Code, et leurs numéros sont autorisés sans autre question. Seule règle conservée, dans le domaine (`numerosAAutoriser`) : un numéro révoqué n'est jamais réautorisé. Le prompt et la configuration de Mina restent hors du MCP : ils se modifient dans `agent/`, se relisent dans git et se poussent par `pnpm agent push`.

## Considered Options

- Une route `/mcp` dans Next : un second secret à la manière du pont, et un `next build` suivi d'un redémarrage de l'interface à chaque changement d'outil.
- Un connecteur claude.ai : le serveur exposé sur Internet, et un OAuth à écrire, pour un opérateur unique.
- Les permissions de Claude Code comme seule garde : le mode sans permissions ou l'acceptation automatique les contournent. Elles restent une seconde couche utile (outils de lecture en `allow`).
- Une confirmation pour chaque numéro nouveau d'un import : écartée par l'opérateur, pour qui demander l'import vaut attestation.

## Consequences

- Un crochet `Elicitation` de Claude Code, configuré par l'utilisateur, peut répondre à sa place : c'est son choix, hors de portée du serveur.
- Le SDK v2 sert en stdio la révision 2025 du protocole. Les outils rendent `inputRequired(...)`, que le SDK traduit en question au client ; la même forme servira telle quelle la révision 2026-07-28. L'accord n'est retenu que s'il porte sur le message recalculé à la reprise.
- Un appel d'outil aux arguments invalides est refusé par le SDK avant l'outil : rien n'est fait, rien n'est journalisé.
- Une campagne simulée lancée par le MCP dure plus qu'une session : elle tourne dans un processus détaché (`mcp/tache.ts`). Une campagne téléphone n'en a pas besoin : l'application enchaîne les appels à chaque fin d'appel.
- Depuis un autre poste du tailnet, un `.mcp.json` local (non commité) lance la même commande par `ssh`.
