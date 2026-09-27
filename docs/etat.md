# État du projet

Point de reprise pour la prochaine session de travail. À tenir à jour à chaque étape.

## Ce qui marche

- Ligne navigateur : on parle à Mina depuis la fiche d'un prospect ou dans une campagne, on peut aussi lui répondre par écrit. Appels simulés pour produire du volume (signalés, exclus de l'analyse par défaut).
- Après chaque appel : transcription et enregistrement rapatriés, bilan produit par `claude -p` isolé et validé par le domaine (citations exactes, pas de « Rendez-vous pris » sans réservation).
- Agenda : disponibilités lues par le connecteur Google Agenda de Claude et gardées en copie ; Mina propose et réserve des visios Google Meet (outils client, rien d'exposé sur Internet), avec l'interlocuteur indiqué dans la fiche de l'entreprise, et invite le prospect si son e-mail est confirmé.
- Mise en service : `scripts/installer-services.sh` (service systemd utilisateur `autocalled-web`), puis `tailscale serve --https=8449`.

## Réglages de Mina retenus à l'écoute

- Cerveau `glm-45-air-fp8` (≈ 0,2 s avant la première réponse), préféré à Qwen et à Gemini.
- Voix « Stella » en `eleven_v3_conversational` (≈ 0,14 s avant le premier son).
- Tour spéculatif désactivé ; acquiescements et hésitations françaises ne l'interrompent pas.
- Synchronisation de la configuration : `pnpm agent pull | push | status` (le verrou suit le numéro de version ElevenLabs).

## À faire

1. **Pont Bluetooth branché sur l'application** : Mina appelle déjà depuis une commande (`apps/pont`, mode d'emploi en tête de `pont/__main__.py`), avec les variables de `apps/web/scripts/variables-appel.ts`. Premier appel le 27/09 : réponses en 0,4 à 1,2 s côté serveur, détection de répondeur opérationnelle, transcription dégradée par le 8 kHz. Reste le palier B : le web crée l'appel (`ligne: 'bluetooth'`) et commande le pont, qui lui renvoie le `conversation_id`, les outils d'agenda (bouchonnés pour l'instant) et la fin d'appel ; écoute en direct depuis le navigateur. Le téléphone passerelle est encore l'iPhone personnel de l'opérateur : passer sur un téléphone dédié (refaire l'appairage avec `apps/pont/spike/appairer.py`).
2. **E-mail dicté** : vérifier sur de vrais appels que Mina s'appuie sur l'épellation et relit l'adresse lettre par lettre avant de réserver (règle ajoutée après une adresse mal transcrite).
3. **Invitation réelle** : tester l'envoi avec sa propre adresse, puis supprimer l'événement.
4. Voir aussi `docs/future-improvements.md`.

## Pièges connus

- Les imports du domaine sont en `.ts` : Turbopack ne remappe pas `.js`.
- En simulation, ElevenLabs invente la réponse des outils client ; les transcriptions simulées en voix v3 contiennent des mots coupés. Ce n'est pas le comportement des vrais appels.
- `playwright-cli` dans une boucle shell avale l'entrée standard : passer par un script ou `</dev/null`.
