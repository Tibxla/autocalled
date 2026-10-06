# Première ligne : un téléphone passerelle en Bluetooth plutôt que Twilio

L'opérateur veut que l'assistante appelle depuis un vrai numéro mobile français qu'il possède déjà, et en profiter pour explorer la téléphonie bas niveau. La première ligne passe donc par un téléphone passerelle appairé en Bluetooth (profil mains-libres) au serveur, avec un pont audio maison vers l'agent ElevenLabs, au lieu de l'intégration native Twilio. On paie ce choix : pas de détection de répondeur par l'opérateur télécom, un pont audio à écrire et à maintenir, une pile Bluetooth Linux fragile, et des conditions de forfait grand public qui tolèrent mal l'usage en passerelle. Il ne tient que parce que la démo est fermée (ADR 0001) ; la téléphonie reste derrière une abstraction de ligne pour pouvoir basculer sur Twilio.

## Considered Options

- Twilio avec un numéro étranger (+1) : immédiat et intégré nativement, mais le numéro affiché n'est pas français.
- Numéro français chez Twilio : dossier réglementaire, et risque de numéro masqué (MAN, 2026).
- Numéro NPV via un opérateur français et un trunk SIP : la voie production, disproportionnée pour une démo.

## Constat du 25 septembre 2026

- La puce Bluetooth interne du serveur (MediaTek MT7902, carte combinée Wi-Fi et Bluetooth) est détectée, et son firmware est déjà installé, mais le pilote `btmtk` du noyau 7.0 ne gère pas encore cette variante (`Unsupported hardware variant (00007902)`) : aucun contrôleur utilisable. Le correctif est proposé en amont et attendu vers Linux 7.1 ou 7.2. En attendant, la ligne passera par une clé USB à puce Realtek RTL8761BU (TP-Link UB500), prise en charge depuis Linux 5.16.
- Reste ouvert : le pont récupère-t-il le flux audio directement auprès d'oFono (agent `HandsfreeAudioAgent`, qui reçoit le descripteur du canal SCO), ou via PipeWire ? La première voie évite une pile audio sur un serveur sans écran. Le langage du pont suivra la bibliothèque D-Bus qui gère le mieux ce passage de descripteur. Python part favori : son SDK ElevenLabs fournit une conversation à interface audio personnalisée (`Conversation` + `AudioInterface`) qui accepte les variables dynamiques de l'appel, et `dbus-fast` sait recevoir un descripteur de fichier. Le pont enregistre lui-même l'audio de l'appel, sans dépendre de la conservation côté ElevenLabs.

## Constat du 27 septembre 2026 (spike validé)

- Avec la clé UB500, l'iPhone s'appaire et oFono en fait un modem mains-libres sans configuration. Le serveur compose (`dial-number`), la sonnerie part en une seconde, et le raccrochage remonte avec sa cause (`DisconnectReason remote` ou `local`). Les scripts du spike sont dans `apps/pont/spike/`.
- Le flux audio passe directement par l'agent `HandsfreeAudioAgent` d'oFono, sans PipeWire : la question ouverte le 25 est tranchée. En CVSD, le canal SCO livre des blocs de 48 octets à 16 000 octets/s (8 kHz, 16 bits, mono), et on écrit un bloc pour chaque bloc lu.
- oFono transmet le canal en attente d'acceptation : une lecture d'un octet l'accepte, puis il faut attendre qu'il devienne inscriptible avant de lire, sinon `ENOTCONN`.
- Le canal s'ouvre dès la composition. La tonalité de retour y passe avant le décroché : Mina ne doit parler qu'à l'état `active`.
- L'annulation d'écho de l'iPhone retire ce que le serveur envoie : le flux entrant ne contient que le correspondant.
- oFono n'accepte sur D-Bus que root et la session locale ; `deploy/dbus/autocalled-ofono.conf` l'ouvre à l'utilisateur du pont, à copier dans `/etc/dbus-1/system.d/`.
- Le profil mains-libres ne choisit pas la ligne sur un iPhone double SIM : l'appel part de la ligne vocale par défaut. Le téléphone passerelle dédié n'aura qu'une SIM.

## Constat du 27 septembre 2026, soir (qualité de la voix)

- En CVSD, la voix de Mina arrive saturée chez le correspondant, quel que soit son niveau : le son envoyé par le pont est propre (vérifié sur l'enregistrement et au rythme des paquets), l'écoute d'un son de test aussi. Le pont déclare donc le mSBC (16 kHz), encodé et décodé par libsbc ; l'iPhone et la clé UB500 l'acceptent. Il supprime aussi le rééchantillonnage vers ElevenLabs, qui travaille en `pcm_16000`.
- Le téléphone traite ce qui arrive du « micro » mains-libres (anti-écho, anti-bruit, gain automatique) en l'attendant faible. Le pont coupe l'anti-écho et l'anti-bruit à chaque appel (`EchoCancelingNoiseReduction`), et envoie Mina vers −31 dBFS au lieu des −13 dBFS d'ElevenLabs : à −19,5 dBFS, l'échelle d'écoute sature encore.
- La liste des codecs compte au moment où la liaison mains-libres s'établit : un agent audio enregistré après coup n'obtient le mSBC que si la liaison l'avait annoncé. Le pont doit donc tourner en permanence, agent enregistré avant toute reconnexion du téléphone.
- Un modem 4G USB avec la voix (Quectel EC25, par exemple) éviterait le Bluetooth, mais les appels passent désormais en VoLTE, que les opérateurs français n'activent que sur les appareils qu'ils ont certifiés : le téléphone passerelle garde sa pile VoLTE certifiée.
- Au décroché, le pont n'ouvre pas tout de suite la conversation : il attend la voix du prospect (son « allô » est gardé puis transmis) ou, après 2 s de silence, l'ouvre avec « Allô ? » comme premier message de Mina. D'où `overrides.conversation_config_override.agent.first_message` autorisé dans la configuration de l'agent ; la ligne navigateur ne s'en sert pas.

## Constat du 6 octobre 2026 (comparaison des timbres)

- Les deux derniers appels utilisent bien le mSBC et du PCM 16 kHz dans les deux sens vers ElevenLabs, sans écriture audio sautée. Pourtant, la voix reçue ne contient pratiquement aucune énergie au-dessus de 3 400 Hz : la liaison Bluetooth large bande ne garantit pas que le réseau mobile conserve cette bande.
- L'égalisation ajoutée le 2 octobre réduisait les graves et renforçait les aigus de 5 dB vers 3 kHz. Cette correction peut accentuer un timbre métallique selon la voix choisie. `PONT_EGALISATION` permet désormais une comparaison réversible : `historique` conserve ce filtre, `douce` garde le traitement des graves et retire uniquement la bosse des aigus, `aucune` désactive le filtre.
- Le profil historique reste le défaut. Tous les profils conservent le gain anti-saturation de −18 dB ; changer de profil ne justifie pas de monter le niveau. Le pont valide la valeur au démarrage et journalise profil et gain, puis les indique à l'ouverture du canal audio. La configuration s'applique après redémarrage hors appel. Le rendu doit être comparé à l'écoute : enlever une correction ne restaure pas les fréquences perdues par le réseau.
