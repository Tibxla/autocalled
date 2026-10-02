# État du projet

Point de reprise pour la prochaine session de travail. À tenir à jour à chaque étape.

## Ce qui marche

- Ligne navigateur : on parle à Mina depuis la fiche d'un prospect ou dans une campagne, on peut aussi lui répondre par écrit. Appels simulés pour produire du volume (signalés, exclus de l'analyse par défaut).
- Après chaque appel : transcription et enregistrement rapatriés, bilan produit par `claude -p` isolé et validé par le domaine (citations exactes, pas de « Rendez-vous pris » sans réservation).
- Agenda : disponibilités lues par le connecteur Google Agenda de Claude et gardées en copie ; Mina propose et réserve des visios Google Meet (outils client, rien d'exposé sur Internet), avec l'interlocuteur indiqué dans la fiche de l'entreprise, et invite le prospect si son e-mail est confirmé.
- Ligne téléphone : appel depuis la fiche, suivi en direct, écoute, rendez-vous réel avec invitation, bilan, appairage et oubli du téléphone, validés sur de vrais appels le 28/09.
- Campagnes : la file se modifie pendant la campagne (sauter, retirer, ajouter, terminer sans couper l'appel en cours) ; un prospect dont le numéro n'est plus appelable à son tour (personne effacée) n'est pas appelé.
- Nouvelles tentatives (ADR 0017), codées et testées, pas encore en production : un appel de campagne « Non abouti » remet le prospect en file, à sa place, pour le lendemain au moment opposé (avant 13 h : 14 h, sinon 9 h, heure de Paris, week-end compris), trois tentatives au plus. L'entrée est « bilan en cours » (`en-analyse`) jusqu'au bilan, qui la classe ; la campagne ne se termine pas avant. Le réveil (`autocalled-reveil.timer`, toutes les 5 minutes, `pnpm reveil --essai`) rattrape les classements perdus et relance les campagnes téléphone dont une tentative est due. Ligne occupée : rien ne part, aucun prospect n'est consommé. L'analyse classe désormais répondeur et filtre d'appel en « Non abouti » (consignes v3).
- Appels entrants (ADR 0018), codés et testés, pas encore en production : un prospect déjà appelé pour de vrai qui rappelle le téléphone passerelle est décroché par Mina (« Allô, oui bonjour, Mina à l'appareil. »), avec la variable `situation_appel` qui lui dit qui rappelle et après quel appel. Un numéro inconnu ou masqué sonne jusqu'à la messagerie, et rien n'est écrit. Colonne `appels.sens` (migration 0019) ; hors plafond ; un appel entrant suivi d'une conversation retire la nouvelle tentative prévue du prospect. Côté pont : 88 tests sans D-Bus ; rien n'a encore sonné pour de vrai.
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
- Mise en service : `scripts/installer-services.sh` (service systemd utilisateur `autocalled-web`, minuteurs `autocalled-purge.timer` et `autocalled-reveil.timer`), puis `tailscale serve --https=8449`. Ligne téléphone : `scripts/installer-pont.sh` (service `autocalled-pont`).

## Réglages de Mina retenus à l'écoute

- Cerveau : `qwen35-397b-a17b` (ElevenLabs redirigeait déjà `glm-45-air-fp8` vers lui). `claude-haiku-4-5` essayé le 30/09 : répliques plus courtes et plus sobres, mais 2,5 à 3,4 s avant de répondre sur les vrais appels (contre environ 1,3 s pour Qwen), et il annonce parfois ses outils à voix haute. Bloc « Ton » réduit de 22 à 9 lignes ; relances de silence « Hmm… » et « Alors… » après 3 s.
- Voix « Stella » en `eleven_v4_turbo` depuis le 29/09 (0,15 s avant le premier son, contre 0,18 s pour `eleven_v3_conversational` et 1 s pour `eleven_v4`, mesurés sur la même phrase) ; à confirmer à l'écoute sur un appel.
- Quand le prospect demande un instant, Mina dit « prenez votre temps » ; l'outil `skip_turn` a été retiré (Qwen se taisait à tort avec). Délai de silence : 7 s.
- Fin de tour en `normal` (`eager` essayé le 30/09 sans gain). Tour spéculatif réactivé le 02/10 pour gagner sur le délai de réponse (1,4 s médiane avant ; deux premiers appels : 1,3 s, gain dans le bruit, à confirmer) ; acquiescements et hésitations françaises ne l'interrompent pas.
- Ouverture (02/10) : au décroché, un accueil court du prospect (voix finie en moins de 2,5 s, puis 500 ms de silence) est jeté, et le pont fait dire aussitôt la première formulation d'exemple de l'étape 1 du script, en premier message de la conversation. Un accueil plus long (standard, répondeur) part au modèle, qui ouvre ou raccroche sur une messagerie ; un silence de 2 s fait dire le premier message de l'assistante (« Allô ? »). Avant : 3,8 s médiane du décroché au premier mot (le modèle rédigeait l'ouverture), et 1,4 s médiane de réponse en conversation, mesurés côté serveur sur 33 décrochés (la mesure du bilan comptait aussi les pauses de Mina dans sa propre réplique et donnait 1,8 s : corrigée le même jour). Le bilan du journal du pont dit le chemin pris (`ouverture`) et `finAccueilVersPremierSonS`.
- Téléphone passerelle sans appels Wi-Fi (02/10) : en appels Wi-Fi, le téléphone ne transmet rien du prospect pendant 1,4 à 2,3 s après le décroché (son « bonjour » est coupé) et l'aller-retour monte à 135 ms ; sur le réseau mobile, 0,5 s et 106 ms. L'opérateur affiché par le pont (« Appels WiFi ») ne se met pas à jour quand on les coupe : se fier à la mesure.
- Synchronisation de la configuration : `pnpm agent pull | push | status` (le verrou suit le numéro de version ElevenLabs).

## Mise en production : nouvelles tentatives et appels entrants

Ni la migration 0019, ni le réveil, ni le nouveau pont, ni le prompt ne sont en production. Dans cet ordre, depuis la copie de production. Le prompt part juste après l'interface et avant le nouveau pont : l'interface envoie déjà `situation_appel` à toutes les lignes, et aucun prospect qui rappelle n'est décroché avec l'ancien prompt (« Tu as appelé… »), puisque seul le nouveau pont décroche.

1. Sauvegarder la base.
2. `pnpm --filter @autocalled/web db:migrate` : applique les migrations en retard, jusqu'à 0019 (type `sens_appel`, colonne `appels.sens`, `sortant` par défaut pour tous les appels déjà enregistrés). Si 0018 n'est pas encore passée, elle supprime deux tables : d'où la sauvegarde.
3. `pnpm reveil --essai` : ce que le réveil classerait et relancerait. Le minuteur ne relance qu’entre 9 h et 19 h (heure de Paris) : toute campagne téléphone en cours qui a quelqu’un de dû, même arrêtée depuis des jours, repart au premier réveil dans cette plage. La suspendre ou la terminer avant si elle ne doit pas repartir.
4. `scripts/installer-services.sh` : reconstruit et relance l'interface, qui envoie désormais `situation_appel` à toutes les lignes (la phrase sortante habituelle), et active `autocalled-reveil.timer`. Le compte rendu du réveil se lit par `journalctl --user -u autocalled-reveil`.
5. Tout de suite après, `pnpm agent push` en relisant la différence (ligne 8 du prompt : `{{situation_appel}}`, et sa valeur d'exemple), puis `pnpm agent status`. Pas avant l'étape 4 : le prompt citerait une variable que l'application n'envoie pas encore, et ElevenLabs refuserait d'ouvrir la conversation.
6. `scripts/installer-pont.sh`, hors appel en cours (il refuse pendant un appel, entrant compris) : détection des appels entrants, raccrochage ciblé. Le redémarrage reconnecte le téléphone.
7. Reconnecter le serveur MCP dans Claude Code (`/mcp`) : il tourne sur le code chargé à son démarrage (ancienne file, ancienne liste de variables pour valider le prompt).
8. Contrôles : l'aperçu « Ce que l'assistante recevra » (`situation_appel` porte la phrase sortante), un appel simulé, puis avec l'opérateur, au téléphone, les points de « À faire » ci-dessous.

## À faire

1. **Nouvelles tentatives et appels entrants, au téléphone**, après la mise en production :
   - `Answer` : l'iPhone décroche-t-il, et en combien de temps ;
   - canal son de l'iPhone à la sonnerie : s'ouvre-t-il dès la sonnerie ou après `Answer` ; le garder sans le lire avant `Answer` gêne-t-il le décroché ; fermé quand on laisse sonner, le téléphone garde-t-il sa sonnerie et sa messagerie ;
   - `LineIdentification` : dans `CallAdded` ou plus tard, au format `+33…` ou `06…` (les deux sont normalisés), `withheld` pour un numéro masqué, et les 2 s d'attente suffisent-elles ;
   - durée de la sonnerie avant la messagerie, face aux 2 s du numéro et aux 3 s de la question à l'application ;
   - un prospect connu qui rappelle est décroché avec l'accueil ; un numéro inconnu sonne jusqu'à la messagerie, sans ligne `appels` ; quelqu'un qui décroche à la main pendant la décision garde le son ;
   - `Hangup` de l'appel actif quand un second appel est en attente : le second survit-il ;
   - tentatives : une tentative prévue part bien vers 9 h ou 14 h ; `finLe` est posé avant le classement (sinon le calcul part de l'heure de l'analyse, et le moment peut basculer) ; plafond atteint au moment d'une tentative : pause, à reprendre à la main ; répondeur et filtre d'appel classés « Non abouti » par l'analyse v3 ;
   - juste après un appel entrant, `/etat` dit encore la ligne occupée jusqu'au `CallRemoved` : la campagne repart alors au réveil suivant.
2. **Interface des tentatives et des appels entrants, à l'écran** : la colonne Tentatives de la file sous 640 px de large, et la troncature de la cellule Issue quand elle porte une tentative prévue.
3. **Ligne téléphone** : reste à valider :
   - prise de main (ADR 0008) : casque, latence, voix de l'opérateur côté prospect, reconnexion si l'onglet se ferme ;
   - campagne sur la ligne téléphone : enchaînement, pause, reprise, plafond ;
   - interruption : couper la parole à Mina en pleine phrase, elle doit s'arrêter ;
   - relecture de l'adresse imposée par `reserver_creneau` ;
   - indicateur de ligne cliquable pendant un appel.
   Diagnostic hors application, service arrêté : `apps/pont`, `python -m pont appeler | tester-son`.
4. **E-mail dicté** : depuis le 28/09, c'est `reserver_creneau` qui impose la relecture (il renvoie l'adresse épelée, et ne réserve qu'avec `adresse_confirmee`), et une correction après réservation est notée sur le rendez-vous (Réglages) au lieu d'être ignorée. À revérifier sur un appel : Mina relit bien l'épellation renvoyée avant de réserver.
5. **Invitation réelle** : tester l'envoi avec sa propre adresse, puis supprimer l'événement.
6. **Serveur MCP en vrai**, après la mise en production : approuver le serveur `autocalled` au démarrage de Claude Code, vérifier que la question de confirmation s'affiche bien (d'abord `regler_ligne` à la hausse, sans effet sur un appel), puis un `lancer_appel` sur la ligne téléphone vers son propre numéro, et une campagne simulée courte (processus détaché).
7. Voir aussi `docs/future-improvements.md`.

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
- Le réveil (`pnpm reveil`) ne relance une campagne qu’entre 9 h et 19 h (heure de Paris), et jamais une campagne en pause ni une simulation : une campagne simulée qui attend ses nouvelles tentatives se relance à la main.
- Un appel téléphone resté « en cours » en base (pont redémarré en plein appel) fait laisser sonner tous les appels entrants pendant une heure. Un appel entrant que le pont n'a jamais pris (décision arrivée après ses 3 s) est passé en échec par le réveil au bout de 10 minutes.
- `next build` signale un accès dynamique au disque dans `lib/appels.ts` (dossier des enregistrements) : avertissement de traçage sans effet sur le service, qui tourne depuis le dépôt.
