# Améliorations futures

- **`voicemail_detection` hors téléphonie.** L'outil est activé, mais son comportement sur une conversation WebSocket (le chemin du pont Bluetooth) n'est pas vérifié. À tester pendant le spike ; repli : `end_call` déclenché par le prompt.
- **Ligne Bluetooth.** Le pont n'existe pas encore : il attend la clé USB (RTL8761BU). La puce interne MT7902 marcherait avec un patch de deux lignes dans `btmtk.c` (`case 0x7902:` avec 0x7922), mais Secure Boot refuse un module non signé tant qu'une clé MOK n'est pas enrôlée, ce qui demande un redémarrage devant l'écran. Le correctif est attendu en amont vers Linux 7.1 ou 7.2.
- **Simulation dépréciée chez ElevenLabs.** `POST /v1/convai/agents/{id}/simulate-conversation` fonctionne mais est marqué obsolète ; son remplaçant est `/v1/convai/agent-testing/create` puis `/v1/convai/agents/{id}/run-tests`. À migrer dans `simulerConversation` (`apps/web/src/lib/elevenlabs.ts`).
