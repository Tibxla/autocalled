# État du projet

Point de reprise pour la prochaine session de travail. À tenir à jour à chaque étape.

## Ce qui marche

- Ligne navigateur : on parle à Mina depuis la fiche d'un prospect ou dans une campagne, on peut aussi lui répondre par écrit. Appels simulés pour produire du volume (signalés, exclus de l'analyse par défaut).
- Après chaque appel : transcription et enregistrement rapatriés, bilan produit par `claude -p` isolé et validé par le domaine (citations exactes, pas de « Rendez-vous pris » sans réservation).
- Agenda : disponibilités lues par le connecteur Google Agenda de Claude et gardées en copie ; Mina propose et réserve des visios Google Meet (outils client, rien d'exposé sur Internet), avec l'interlocuteur indiqué dans la fiche de l'entreprise, et invite le prospect si son e-mail est confirmé.
- Ligne téléphone : appel depuis la fiche, suivi en direct, écoute, rendez-vous réel avec invitation, bilan, appairage et oubli du téléphone, validés sur de vrais appels le 28/09.
- Campagnes : la file se modifie pendant la campagne (sauter, retirer, ajouter, terminer sans couper l'appel en cours) ; un prospect dont le numéro n'est plus appelable à son tour (personne effacée) n'est pas appelé.
- Rappels datés (ADR 0011) : l'analyse date le rappel convenu, l'accueil liste ceux du jour et ceux en retard, la liste des appels filtre les rappels à faire.
- Appels : filtres, comptes et pagination en base ; appel précédent et suivant sur la liste filtrée.
- Entreprises : aperçu de ce que l'assistante recevra, objections réordonnées, scripts renommés et archivés, garde contre les écritures concurrentes avec Claude Code (ADR 0012).
- Barre du haut : plafond atteint et heure du prochain appel possible, chrono depuis le décroché, campagne ouverte. L'outil client `etape_script` (étape du plan affichée dans la bande) est retiré de l'agent depuis le 02/10 : chaque appel relançait le modèle, qui parlait une seconde fois sans attendre la réponse (accroche dite deux fois, « allez-y, je vous écoute » dit à sa propre question). Le pont et l'interface gardent son code, inerte.
- Assistante : son nom (Mina par défaut) et son premier message vivent en base et valent dès l'appel suivant ; chaque appel garde le nom sous lequel elle s'est présentée ; le prompt le reçoit par `assistante_nom` (ADR 0010). Réglages les montre en lecture seule.
- Serveur MCP (ADR 0009 et 0010) : 58 outils, dont 19 de lecture, lisent et écrivent tout le produit, assistante comprise (nom, premier message, prompt, réglages, poussée et historique) ; appels, campagnes et gestes qui engagent passent par une question à l'opérateur (élicitation) ; chaque appel d'outil est journalisé (Réglages). Skill de projet `.claude/skills/autocalled`. Testé contre la base `autocalled_test` et un faux pont, test de fumée en stdio compris.
- Sécurité (livraison du 29/09) : hôte vérifié, en-têtes anti-encadrement, routes du pont refusées hors de 127.0.0.1, identité simulée locale seulement, `claude -p` restreint, pont en E.164 seulement avec plafond à chaque composition et journal sans parole du prospect, fichiers en 0600 et services en `UMask=0077`.
- Durée de conservation (ADR 0014) : chaque nuit, un appel de plus de `DUREE_CONSERVATION_MOIS` (12) perd enregistrements, transcription et texte du bilan (issue, étapes, objections gardées, analyse des versions inchangée), et le journal des gestes (MCP et interface) ses lignes du même âge. `pnpm purger --essai` compte sans rien toucher.
- Journal des gestes (ADR 0016) : les gestes d'écriture de la page Assistante entrent dans `journal_mcp` avec l'origine `interface` (migration 0017), la question lue d'abord ; Réglages et `lire_journal_mcp` filtrent par origine, la page Assistante montre ses cinq derniers gestes.
- Prospects (ADR 0001) : une fiche importée est appelable aussitôt ; seul un numéro invalide ou d'une personne effacée n'est pas composé. La migration 0018 supprime deux tables : sauvegarder la base avant de l'appliquer.
- Mise en service : `scripts/installer-services.sh` (service systemd utilisateur `autocalled-web`, minuteur `autocalled-purge.timer`), puis `tailscale serve --https=8449`. Ligne téléphone : `scripts/installer-pont.sh` (service `autocalled-pont`).

## Réglages de Mina retenus à l'écoute

- Cerveau : `qwen35-397b-a17b` (ElevenLabs redirigeait déjà `glm-45-air-fp8` vers lui). `claude-haiku-4-5` essayé le 30/09 : répliques plus courtes et plus sobres, mais 2,5 à 3,4 s avant de répondre sur les vrais appels (contre environ 1,3 s pour Qwen), et il annonce parfois ses outils à voix haute. Bloc « Ton » réduit de 22 à 9 lignes ; relances de silence « Hmm… » et « Alors… » après 3 s.
- Voix « Stella » en `eleven_v4_turbo` depuis le 29/09 (0,15 s avant le premier son, contre 0,18 s pour `eleven_v3_conversational` et 1 s pour `eleven_v4`, mesurés sur la même phrase) ; à confirmer à l'écoute sur un appel.
- Quand le prospect demande un instant, Mina dit « prenez votre temps » ; l'outil `skip_turn` a été retiré (Qwen se taisait à tort avec). Délai de silence : 7 s.
- Fin de tour en `normal` (`eager` essayé le 30/09 sans gain). Tour spéculatif réactivé le 02/10 pour gagner sur le délai de réponse (1,4 s médiane avant ; deux premiers appels : 1,3 s, gain dans le bruit, à confirmer) ; acquiescements et hésitations françaises ne l'interrompent pas.
- Ouverture (02/10) : au décroché, un accueil court du prospect (voix finie en moins de 2,5 s, puis 500 ms de silence) est jeté, et le pont fait dire aussitôt la première formulation d'exemple de l'étape 1 du script, en premier message de la conversation. Un accueil plus long (standard, répondeur) part au modèle, qui ouvre ou raccroche sur une messagerie ; un silence de 2 s fait dire le premier message de l'assistante (« Allô ? »). Avant : 3,8 s médiane du décroché au premier mot (le modèle rédigeait l'ouverture), et 1,4 s médiane de réponse en conversation, mesurés côté serveur sur 33 décrochés (la mesure du bilan comptait aussi les pauses de Mina dans sa propre réplique et donnait 1,8 s : corrigée le même jour). Le bilan du journal du pont dit le chemin pris (`ouverture`) et `finAccueilVersPremierSonS`.
- Synchronisation de la configuration : `pnpm agent pull | push | status` (le verrou suit le numéro de version ElevenLabs).

## Livraison à mettre en production

La branche `livraison/mcp-securite` (worktree `autocalled-livraison`) n'est ni fusionnée ni déployée. La production est à la migration 0012 et tourne avec l'ancienne configuration ElevenLabs. Dans cet ordre, depuis la copie de production :

1. Fusionner dans `main`, puis `pnpm install` (nouveau paquet `packages/agent`).
2. `pnpm --filter @autocalled/web db:migrate` : applique 0013 (table `assistante`, historique des configurations, nom figé sur chaque appel), 0014 (liste d'opposition, archivage) et 0015 (`purge_le`). Puis `pnpm purger --essai` : ce que la purge quotidienne, activée à l'étape suivante, supprimera.
3. `scripts/installer-services.sh` : reconstruit l'interface, recopie le service durci et active `autocalled-purge.timer` (ADR 0014).
4. `scripts/installer-pont.sh` hors appel en cours : dépendances épinglées, service durci, premier message venu de l'application, outil `etape_script`.
5. Seulement ensuite, `pnpm agent push` en relisant la différence (prompt avec `assistante_nom`, outil `etape_script`, valeurs d'exemple), puis `pnpm agent status`. Poussé avant les étapes 3 et 4, le prompt cite une variable que personne n'envoie encore, et ElevenLabs refuse d'ouvrir la conversation.
6. Contrôles : un appel simulé, un appel navigateur (l'étape s'affiche dans la bande), puis avec l'opérateur un appel téléphone réel ; dans Claude Code, un `pousser_assistante` sans changement (refus « rien à pousser ») et un `modifier_assistante` pour voir la question de confirmation.
7. ~~Mesurer la latence avec l'outil `etape_script`~~ : retiré le 02/10, voir plus haut.

## À faire

1. **Ligne téléphone** : reste à valider :
   - prise de main (ADR 0008) : casque, latence, voix de l'opérateur côté prospect, reconnexion si l'onglet se ferme ;
   - campagne sur la ligne téléphone : enchaînement, pause, reprise, plafond ;
   - interruption : couper la parole à Mina en pleine phrase, elle doit s'arrêter ;
   - relecture de l'adresse imposée par `reserver_creneau` ;
   - indicateur de ligne cliquable pendant un appel.
   Diagnostic hors application, service arrêté : `apps/pont`, `python -m pont appeler | tester-son`.
2. **E-mail dicté** : depuis le 28/09, c'est `reserver_creneau` qui impose la relecture (il renvoie l'adresse épelée, et ne réserve qu'avec `adresse_confirmee`), et une correction après réservation est notée sur le rendez-vous (Réglages) au lieu d'être ignorée. À revérifier sur un appel : Mina relit bien l'épellation renvoyée avant de réserver.
3. **Invitation réelle** : tester l'envoi avec sa propre adresse, puis supprimer l'événement.
4. **Serveur MCP en vrai**, après la mise en production : approuver le serveur `autocalled` au démarrage de Claude Code, vérifier que la question de confirmation s'affiche bien (d'abord `regler_ligne` à la hausse, sans effet sur un appel), puis un `lancer_appel` sur la ligne téléphone vers son propre numéro, et une campagne simulée courte (processus détaché).
5. Voir aussi `docs/future-improvements.md`.

## Pièges connus

- Les imports du domaine sont en `.ts` : Turbopack ne remappe pas `.js`.
- En simulation, ElevenLabs invente la réponse des outils client ; les transcriptions simulées en voix v3 contiennent des mots coupés. Ce n'est pas le comportement des vrais appels.
- `playwright-cli` dans une boucle shell avale l'entrée standard : passer par un script ou `</dev/null`.
- Chaque redémarrage du pont reconnecte le téléphone (pour annoncer le mSBC) et coupe l'appel en cours, dont la fin n'atteint jamais l'application : vérifier `appelEnCours` (GET /etat) avant, comme le fait `scripts/installer-pont.sh`.
- `pkill -f <motif>` dans une commande dont le texte contient ce motif se tue lui-même : viser le PID.
- Hors de Next (serveur MCP, scripts), `next/navigation` ne se charge pas sous `--conditions=react-server`, et `after()` lève : les pages lisent par `lib/pages.ts` (404), le reste de `lib/` par `lib/donnees.ts`, et les tâches de fond passent par `enFond` (`lib/fond.ts`).
- Les tests de `apps/web` vident la base `autocalled_test` entre deux cas : ils refusent toute base dont le nom ne finit pas par `_test`. Deux séries de tests lancées en même temps sur cette base se gênent : un échec de ligne manquante ou de doublon se relance seul avant d'être cherché.
- Le service `autocalled-web` sert la copie depuis laquelle `scripts/installer-services.sh` a été lancé (chemin écrit dans son unité à l'installation) : un worktree ne se sert pas par lui, sauf à y relancer l'installateur.
- Le serveur MCP valide le prompt contre les variables du code de la copie où il tourne, pas contre celles de la production.
- `next build` signale un accès dynamique au disque dans `lib/appels.ts` (dossier des enregistrements) : avertissement de traçage sans effet sur le service, qui tourne depuis le dépôt.
