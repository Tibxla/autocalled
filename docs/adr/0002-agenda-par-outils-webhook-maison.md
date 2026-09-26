# Agenda : outils client maison, lus par le connecteur Google de Claude

Mina propose et réserve des créneaux avec deux outils maison, `proposer_creneaux` et `reserver_creneau`, plutôt qu'avec l'intégration Cal.com d'ElevenLabs : cette intégration est attachée à l'agent, alors que Mina, agent unique, représente plusieurs entreprises aux règles de rendez-vous différentes.

Ces outils sont des outils « client » : c'est la ligne qui les exécute (la page du navigateur aujourd'hui, le pont Bluetooth demain), et elle interroge le serveur sur le tailnet. Rien n'est donc exposé sur Internet, contrairement à des outils webhook qu'ElevenLabs devrait pouvoir joindre.

L'agenda est lu par le connecteur Google Agenda de Claude (MCP), via `claude -p`, pour éviter de créer un client OAuth Google. Ce connecteur met une vingtaine de secondes à répondre : on garde une copie des plages occupées, relue avant les appels (au plus toutes les dix minutes), Mina propose ses créneaux à partir de cette copie, et l'événement d'un rendez-vous réservé est créé juste après, en tâche de fond. L'API Google directe reste possible et prend le relais si un client OAuth est connecté.

## Consequences

- Un événement ajouté dans l'agenda quelques minutes avant un appel peut ne pas être vu.
- Une ligne sans exécution côté client (Twilio, simulation) n'a pas d'agenda. En simulation, ElevenLabs invente la réponse des outils client : un appel simulé ne peut donc pas être classé « Rendez-vous pris », faute de réservation réelle.
