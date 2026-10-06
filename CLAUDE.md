# Autocalled : consignes pour Claude Code

Une assistante vocale ElevenLabs (Mina par défaut) appelle des prospects pour des entreprises, depuis un vrai téléphone relié en Bluetooth. Le README décrit le produit et l'architecture ; ce fichier dit comment y toucher sans casser la production.

## Lire avant de modifier

- `docs/etat.md` : point de reprise, ce qui tourne en production, ce qui reste à tester au téléphone, pièges connus. À tenir à jour à chaque étape livrée.
- `CONTEXT.md` : le vocabulaire (prospect, fiche, tentative, ligne, appel entrant…). Le code, l'interface et les commits l'emploient tel quel.
- `docs/adr/` : les décisions. Une décision qui en contredit une passe par un nouvel ADR ou un amendement, jamais par un changement silencieux.
- README, « Mettre à jour » : l'ordre de mise en production.

## Cette copie EST la production

- Les services (`autocalled-web`, `autocalled-pont`, minuteurs `autocalled-reveil` et `autocalled-purge`) tournent depuis ce dossier, sur la branche `demo`. `main` garde une version plus complète, incompatible avec la base de production (migration 0018) : ne jamais changer de branche ici ni déployer `main`.
- Un fichier modifié ne change rien en production avant le déploiement, dans l'ordre du README : migration (base sauvegardée d'abord), `scripts/installer-services.sh` (interface), `pnpm agent push` (prompt), `scripts/installer-pont.sh` (pont).
- Le réveil compose de vrais appels toutes les 5 minutes entre 9 h et 19 h (heure de Paris) : `pnpm reveil --essai` avant tout changement des campagnes, des tentatives ou des rappels.
- Le pont ne se redémarre jamais pendant un appel : lire `appelEnCours` et `entrantEnCours` sur `GET http://127.0.0.1:3021/etat` (en-tête `Authorization: Bearer $PONT_SECRET`) d'abord. Chaque redémarrage reconnecte le téléphone.
- Aucun appel réel sans demande de l'opérateur, et jamais vers un prospect pour un essai : les essais se font sur la fiche de test de l'opérateur.
- Le serveur MCP garde le code chargé à son démarrage : après une modification de `apps/web`, le reconnecter (`/mcp`) avant de s'en servir.
- D'autres sessions travaillent parfois dans ce dossier en même temps. `git status` avant de commencer ; ne commiter que ses fichiers (`git commit -- <fichiers>`), ne jamais annuler un changement qu'on n'a pas fait.

## Dépôt public

- Rien des vrais appels ni des vrais prospects : ni transcription, ni réplique, ni nom, numéro, e-mail ou entreprise réels, même en exemple dans un prompt, un test, une doc ou un message de commit. Numéros fictifs dans les tests : `+33639980001` et suivants.
- Aucun nom ni lien vers un dépôt privé ou un service personnel : un service qui emprunte la ligne s'appelle « un service local ».
- Secrets dans `.env` seulement (`.env.example` documente chaque variable avec une valeur fictive).
- Avant chaque push : relire `git diff origin/demo..demo` à la recherche de numéros, noms et identifiants réels.

## Commandes

| Commande | Usage |
|---|---|
| `pnpm test` | domaine, agenda, agent, application et serveur MCP (base `autocalled_test`, jamais une autre) |
| `pnpm typecheck` | types, racine et paquets |
| `cd apps/web && npx eslint src mcp` | lint |
| `cd apps/pont && .venv/bin/python -m unittest discover` | tests du pont, sans D-Bus (unittest, pas pytest) |
| `pnpm agent status` / `pull` / `push` | configuration de l'assistante (`agent/`) contre ElevenLabs, avec verrou |

Aucun test n'appelle ElevenLabs, `claude -p` ni le vrai pont. Une fonctionnalité se code en TDD, dans le style autour : noms et commentaires en français, commentaires rares.

## L'assistante (`agent/`)

- `agent/prompt.md` et `agent/mina.config.json` sont la source : on les modifie, on relit la différence de `pnpm agent push`, puis on commite le verrou mis à jour.
- `push` n'envoie que les champs listés dans `CHAMPS_GERES` (`packages/agent/src/configuration.ts`) : un nouveau réglage ElevenLabs s'ajoute là d'abord, sinon il est perdu en silence.
- Le prompt ne cite une variable (`{{…}}`) que si l'interface l'envoie déjà en production : sinon ElevenLabs refuse d'ouvrir la conversation.
- ElevenLabs peut rediriger un modèle déprécié sans le dire : le modèle réel se lit dans `producing_llm` des conversations.

## Mesurer avant de conclure

- Délais d'un appel : le bilan du journal du pont (`data/pont/<appel>.log` : `decrocheVersPremierSonS`, `finAccueilVersPremierSonS`, `tempsDeReponseS`, `ouverture`) et, par tour, `conversation_turn_metrics` de `GET /v1/convai/conversations/<id>`.
- Le son passe en bande téléphonique étroite (300-3 400 Hz) même en VoLTE ; les appels Wi-Fi du téléphone passerelle coupent le début de ce que dit le prospect au décroché.
- Un gain annoncé se chiffre sur de vrais appels, comparé à la médiane d'avant, pas sur un seul essai.

## Pièges

- `next build` qui plante en « TurbopackInternalError … parse was canceled » : `rm -rf apps/web/.next/cache/turbopack`, puis relancer `scripts/installer-services.sh`.
- Les imports relatifs des paquets s'écrivent en `.ts` (Turbopack ne remappe pas `.js`).
- Les bilans passent par `claude -p` isolé (ADR 0005, `apps/web/src/lib/claude.ts`) : dossier vide, `--restricted`, sans outils ni ce fichier. Ne pas relâcher ces options.
