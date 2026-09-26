# Améliorations futures

- **`voicemail_detection` hors téléphonie.** L'outil est activé, mais son comportement sur une conversation WebSocket (le chemin du pont Bluetooth) n'est pas vérifié. À tester pendant le spike ; repli : `end_call` déclenché par le prompt.
- **« Rendez-vous pris » sans réservation.** Tant que les outils d'agenda ne sont pas déclarés, Mina peut convenir d'un jour à l'oral et l'analyseur classe l'appel en « Rendez-vous pris ». Une fois l'agenda branché, exiger une ligne dans `rendez_vous` pour cette issue (sinon « Rappel convenu »).
- **Ligne Bluetooth.** Le pont n'existe pas encore : il attend la clé USB (RTL8761BU). La puce interne MT7902 marche avec le patch `btmtk` (dans `/usr/src/btmtk-mt7902-1.0/`), mais Secure Boot refuse le module tant que la clé MOK n'est pas enrôlée, ce qui demande un redémarrage devant l'écran.
- **Simulation dépréciée chez ElevenLabs.** `POST /v1/convai/agents/{id}/simulate-conversation` fonctionne mais est marqué obsolète ; son remplaçant est `/v1/convai/agent-testing/create` puis `/v1/convai/agents/{id}/run-tests`. À migrer dans `simulerConversation` (`apps/web/src/lib/elevenlabs.ts`).
