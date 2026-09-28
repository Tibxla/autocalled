# Améliorations futures

- **Puce Bluetooth interne.** La ligne passe par la clé USB (RTL8761BU). La puce interne MT7902 marcherait avec un patch de deux lignes dans `btmtk.c` (`case 0x7902:` avec 0x7922), mais Secure Boot refuse un module non signé tant qu'une clé MOK n'est pas enrôlée, ce qui demande un redémarrage devant l'écran. Le correctif est attendu en amont vers Linux 7.1 ou 7.2.
- **Simulation dépréciée chez ElevenLabs.** `POST /v1/convai/agents/{id}/simulate-conversation` fonctionne mais est marqué obsolète ; son remplaçant est `/v1/convai/agent-testing/create` puis `/v1/convai/agents/{id}/run-tests`. À migrer dans `simulerConversation` (`apps/web/src/lib/elevenlabs.ts`).
- **Écoute en direct.** Le pont voit passer les deux flux : il pourrait les dupliquer vers une page d'écoute pendant l'appel. Aujourd'hui, on n'a l'enregistrement qu'après coup.
- **Après une prise de main.** La conversation ElevenLabs s'arrête au relais : transcription et bilan ne couvrent que Mina. L'enregistrement stéréo du pont a tout l'appel ; le transcrire (Scribe) compléterait le bilan. Et Mina pourrait annoncer le relais (« je vous passe Thibaud ») si l'API offre un jour un déclencheur propre.
