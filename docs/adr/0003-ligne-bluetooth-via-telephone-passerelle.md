# Première ligne : un téléphone passerelle en Bluetooth plutôt que Twilio

L'opérateur veut que l'assistante appelle depuis un vrai numéro mobile français qu'il possède déjà, et en profiter pour explorer la téléphonie bas niveau. La première ligne passe donc par un téléphone passerelle appairé en Bluetooth (profil mains-libres) au serveur, avec un pont audio maison vers l'agent ElevenLabs, au lieu de l'intégration native Twilio. On paie ce choix : pas de détection de répondeur par l'opérateur télécom, un pont audio à écrire et à maintenir, une pile Bluetooth Linux fragile, et des conditions de forfait grand public qui tolèrent mal l'usage en passerelle. Il ne tient que parce que la démo est fermée (ADR 0001) ; la téléphonie reste derrière une abstraction de ligne pour pouvoir basculer sur Twilio.

## Considered Options

- Twilio avec un numéro étranger (+1) : immédiat et intégré nativement, mais le numéro affiché n'est pas français.
- Numéro français chez Twilio : dossier réglementaire, et risque de numéro masqué (MAN, 2026).
- Numéro NPV via un opérateur français et un trunk SIP : la voie production, disproportionnée pour une démo.

## Constat du 25 septembre 2026

- La puce Bluetooth interne du serveur (MediaTek MT7902) n'est pas prise en charge par le pilote `btmtk` du noyau installé (`Unsupported hardware variant (00007902)`) : aucun contrôleur utilisable. La ligne Bluetooth passera par une clé USB Bluetooth dont la prise en charge de l'audio SCO sous Linux est connue.
- Reste ouvert : le pont récupère-t-il le flux audio directement auprès d'oFono (agent `HandsfreeAudioAgent`, qui reçoit le descripteur du canal SCO), ou via PipeWire ? La première voie évite une pile audio sur un serveur sans écran. Le langage du pont suivra la bibliothèque D-Bus qui gère le mieux ce passage de descripteur.
