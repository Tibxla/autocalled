# État du projet

Point de reprise pour la prochaine session de travail. À tenir à jour à chaque étape.

## Ce qui marche

- Ligne navigateur : on parle à Mina depuis la fiche d'un prospect ou dans une campagne, on peut aussi lui répondre par écrit. Appels simulés pour produire du volume (signalés, exclus de l'analyse par défaut).
- Après chaque appel : transcription et enregistrement rapatriés, bilan produit par `claude -p` isolé et validé par le domaine (citations exactes, pas de « Rendez-vous pris » sans réservation).
- Agenda : disponibilités lues par le connecteur Google Agenda de Claude et gardées en copie ; Mina propose et réserve des visios Google Meet (outils client, rien d'exposé sur Internet), avec l'interlocuteur indiqué dans la fiche de l'entreprise, et invite le prospect si son e-mail est confirmé.
- Mise en service : `scripts/installer-services.sh` (service systemd utilisateur `autocalled-web`), puis `tailscale serve --https=8449`. Ligne téléphone : `scripts/installer-pont.sh` (service `autocalled-pont`).

## Réglages de Mina retenus à l'écoute

- Cerveau `glm-45-air-fp8` (≈ 0,2 s avant la première réponse), préféré à Qwen et à Gemini.
- Voix « Stella » en `eleven_v3_conversational` (≈ 0,14 s avant le premier son).
- Tour spéculatif désactivé ; acquiescements et hésitations françaises ne l'interrompent pas.
- Synchronisation de la configuration : `pnpm agent pull | push | status` (le verrou suit le numéro de version ElevenLabs).

## À faire

1. **Valider la ligne téléphone sur de vrais appels** (écrite le 27/09, ADR 0007, vérifiée sans appel : routes, pages, pont, tests) :
   - appel depuis une fiche prospect : suivi en direct (états, transcription), bouton Raccrocher, écoute (retard, coupures) ;
   - agenda réel : Mina propose et réserve (supprimer ensuite l'événement de test) ;
   - bilan après l'appel, y compris quand le prospect ne décroche pas ;
   - campagne sur la ligne téléphone : enchaînement, pause, reprise ;
   - interruption : couper la parole à Mina en pleine phrase, elle doit s'arrêter ;
   - page Téléphone : appairage du téléphone dédié (et oubli de l'iPhone personnel) ;
   - enregistrement : la page d'appel prend celui d'ElevenLabs ; s'il manque, brancher le WAV stéréo du pont (`data/pont/<appelId>.wav`, converti en `enregistrements/<id>.mp3`), comme le promet l'ADR 0003.
   Diagnostic hors application, service arrêté : `apps/pont`, `python -m pont appeler | tester-son`.
2. **E-mail dicté** : vérifier sur de vrais appels que Mina s'appuie sur l'épellation et relit l'adresse lettre par lettre avant de réserver (règle ajoutée après une adresse mal transcrite).
3. **Invitation réelle** : tester l'envoi avec sa propre adresse, puis supprimer l'événement.
4. Voir aussi `docs/future-improvements.md`.

## Pièges connus

- Les imports du domaine sont en `.ts` : Turbopack ne remappe pas `.js`.
- En simulation, ElevenLabs invente la réponse des outils client ; les transcriptions simulées en voix v3 contiennent des mots coupés. Ce n'est pas le comportement des vrais appels.
- `playwright-cli` dans une boucle shell avale l'entrée standard : passer par un script ou `</dev/null`.
- Chaque redémarrage du pont reconnecte le téléphone (pour annoncer le mSBC) et coupe l'appel en cours, dont la fin n'atteint jamais l'application : vérifier `appelEnCours` (GET /etat) avant, comme le fait `scripts/installer-pont.sh`.
- `pkill -f <motif>` dans une commande dont le texte contient ce motif se tue lui-même : viser le PID.
