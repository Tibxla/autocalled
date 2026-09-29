# État du projet

Point de reprise pour la prochaine session de travail. À tenir à jour à chaque étape.

## Ce qui marche

- Ligne navigateur : on parle à Mina depuis la fiche d'un prospect ou dans une campagne, on peut aussi lui répondre par écrit. Appels simulés pour produire du volume (signalés, exclus de l'analyse par défaut).
- Après chaque appel : transcription et enregistrement rapatriés, bilan produit par `claude -p` isolé et validé par le domaine (citations exactes, pas de « Rendez-vous pris » sans réservation).
- Agenda : disponibilités lues par le connecteur Google Agenda de Claude et gardées en copie ; Mina propose et réserve des visios Google Meet (outils client, rien d'exposé sur Internet), avec l'interlocuteur indiqué dans la fiche de l'entreprise, et invite le prospect si son e-mail est confirmé.
- Serveur MCP (ADR 0009) : Claude Code, ouvert dans le dépôt, lit et configure tout le produit, lance appels et campagnes après accord de l'opérateur (élicitation), et chaque appel d'outil est journalisé (Réglages). Testé contre la base `autocalled_test` et un faux pont, test de fumée en stdio compris ; `claude mcp list` le voit connecté.
- Mise en service : `scripts/installer-services.sh` (service systemd utilisateur `autocalled-web`), puis `tailscale serve --https=8449`. Ligne téléphone : `scripts/installer-pont.sh` (service `autocalled-pont`).

## Réglages de Mina retenus à l'écoute

- Cerveau `glm-45-air-fp8` (≈ 0,2 s avant la première réponse), préféré à Qwen et à Gemini.
- Voix « Stella » en `eleven_v4_turbo` depuis le 29/09 (0,15 s avant le premier son, contre 0,18 s pour `eleven_v3_conversational` et 1 s pour `eleven_v4`, mesurés sur la même phrase) ; à confirmer à l'écoute sur un appel.
- Tour spéculatif désactivé ; acquiescements et hésitations françaises ne l'interrompent pas.
- Synchronisation de la configuration : `pnpm agent pull | push | status` (le verrou suit le numéro de version ElevenLabs).

## À faire

1. **Ligne téléphone** : validée sur de vrais appels le 28/09 (appel depuis la fiche, suivi en direct, écoute, rendez-vous réel et invitation depuis l'agenda `AGENDA_CALENDRIER`, bilan, appairage et oubli d'un téléphone). Reste à valider :
   - prise de main (ADR 0008) : casque, latence, voix de l'opérateur côté prospect, reconnexion si l'onglet se ferme ;
   - campagne sur la ligne téléphone : enchaînement, pause, reprise, plafond ;
   - interruption : couper la parole à Mina en pleine phrase, elle doit s'arrêter ;
   - relecture de l'adresse imposée par `reserver_creneau` ;
   - indicateur de ligne cliquable pendant un appel.
   Diagnostic hors application, service arrêté : `apps/pont`, `python -m pont appeler | tester-son`.
2. **E-mail dicté** : depuis le 28/09, c'est `reserver_creneau` qui impose la relecture (il renvoie l'adresse épelée, et ne réserve qu'avec `adresse_confirmee`), et une correction après réservation est notée sur le rendez-vous (Réglages) au lieu d'être ignorée. À revérifier sur un appel : Mina relit bien l'épellation renvoyée avant de réserver.
3. **Invitation réelle** : tester l'envoi avec sa propre adresse, puis supprimer l'événement.
4. **Serveur MCP en vrai** : approuver le serveur `autocalled` au démarrage de Claude Code, vérifier que la question de confirmation s'affiche bien (d'abord `regler_ligne` à la hausse, sans effet sur un appel), puis un `lancer_appel` sur la ligne téléphone vers un numéro autorisé, et une campagne simulée courte (processus détaché).
5. Voir aussi `docs/future-improvements.md`.

## Pièges connus

- Les imports du domaine sont en `.ts` : Turbopack ne remappe pas `.js`.
- En simulation, ElevenLabs invente la réponse des outils client ; les transcriptions simulées en voix v3 contiennent des mots coupés. Ce n'est pas le comportement des vrais appels.
- `playwright-cli` dans une boucle shell avale l'entrée standard : passer par un script ou `</dev/null`.
- Chaque redémarrage du pont reconnecte le téléphone (pour annoncer le mSBC) et coupe l'appel en cours, dont la fin n'atteint jamais l'application : vérifier `appelEnCours` (GET /etat) avant, comme le fait `scripts/installer-pont.sh`.
- `pkill -f <motif>` dans une commande dont le texte contient ce motif se tue lui-même : viser le PID.
- Hors de Next (serveur MCP, scripts), `next/navigation` ne se charge pas sous `--conditions=react-server`, et `after()` lève : les pages lisent par `lib/pages.ts` (404), le reste de `lib/` par `lib/donnees.ts`, et les tâches de fond passent par `enFond` (`lib/fond.ts`).
- Les tests de `apps/web` vident la base `autocalled_test` entre deux cas : ils refusent toute base dont le nom ne finit pas par `_test`.
