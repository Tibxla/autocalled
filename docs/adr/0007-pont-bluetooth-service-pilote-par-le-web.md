# Le pont Bluetooth est un service permanent, piloté par l'application web

Le pont (`apps/pont`, Python) tourne en service systemd à côté de l'application web et n'écoute que sur 127.0.0.1. Il ne touche jamais la base : l'application reste maîtresse de l'appel. Elle vérifie le numéro autorisé, prépare les variables de Mina (`preparerAppel`), crée l'appel (`ligne: 'bluetooth'`), puis demande au pont de composer. En retour, le pont lui transmet le `conversation_id` dès l'ouverture de la conversation (sans lui, le bilan ne peut pas être rapatrié), fait exécuter les outils d'agenda par les fonctions existantes, et signale la fin de l'appel, qui déclenche le bilan comme pour la ligne navigateur.

Le service est permanent pour deux raisons. Le mSBC, sans lequel la voix de Mina sature (ADR 0003), n'est accordé que si l'agent audio est enregistré quand le téléphone se connecte. Et l'application web redémarre à chaque mise à jour, ce qui couperait un appel en cours si elle portait le pont.

Les deux sens sont authentifiés par un secret partagé, `PONT_SECRET`, généré à l'installation. Les routes que le pont appelle (`/api/pont/…`) sont servies sur le tailnet comme le reste de l'application : ce secret est leur seule garde, et c'est voulu. Le pont ne se fait jamais passer pour l'opérateur en forgeant l'en-tête `Tailscale-User-Login`, même si l'application l'accepterait depuis la machine : ce serait une porte ouverte à tout processus local.

L'écoute en direct d'un appel et sa transcription passent par l'application, qui relaie les flux du pont à l'opérateur authentifié (ADR 0006). La page d'un appel en direct est la même pour les deux lignes, seule la source change. On entend le prospect et Mina avec une à deux secondes de retard, sans pouvoir parler.

Le téléphone passerelle se gère depuis l'application : état (connecté, opérateur, signal, batterie, codec) et appairage. Celui-ci ouvre une fenêtre de trois minutes filtrée sur l'adresse du téléphone et affiche le code à comparer, puis se referme de lui-même. Un script, `scripts/installer-pont.sh`, installe tout le reste : paquets système, environnement Python, règle D-Bus pour l'utilisateur du service, service systemd, secret.

## Considered Options

- Le pont écrit lui-même en base : deux écrivains pour la même table, et la logique de `preparerAppel` ou `traiterAppel` recopiée en Python.
- L'application lance le pont en sous-processus : le pont meurt à chaque redémarrage de l'application, et le mSBC avec lui.
- Le pont s'authentifie en forgeant l'en-tête Tailscale : refusé, voir plus haut.

## Consequences

- Le pont refuse tout canal son qui ne vient pas d'un appel qu'il a composé. Sans ça, les appels reçus sur le téléphone passerelle arriveraient au serveur et plus personne ne les entendrait sur le téléphone. Un téléphone dédié reste la bonne configuration.
- Si le canal son ne s'ouvre pas dans les secondes qui suivent la composition (vu une fois après un appel passé à la main sur le téléphone), le pont raccroche, reconnecte le téléphone et recommence une fois, puis signale la panne à l'application.
- Le pont plafonne les appels sortants (15 par heure et 50 par jour par défaut), avec une pause réglable entre deux appels de campagne. Ces garde-fous se règlent sur la page Téléphone ; le pont les garde et les applique lui-même, `.env` ne donne que les valeurs par défaut. Ce qui fait signaler un numéro comme démarchage, ce sont des rafales d'appels courts ou sans réponse, qu'une campagne où personne ne décroche ou un bug produiraient. Plafond atteint, la campagne se met en pause sans consommer le prospect suivant.
- La ligne Bluetooth demande du matériel : un serveur Linux, une clé Bluetooth reconnue, un téléphone avec sa carte SIM. Sans ce matériel, le produit reste utilisable par la ligne navigateur, et plus tard par Twilio.
- `apps/web/scripts/variables-appel.ts` et la commande `python -m pont appeler` restent des outils de diagnostic ; le chemin normal passe par l'application.
