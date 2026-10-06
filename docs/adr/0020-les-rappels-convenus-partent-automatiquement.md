# Un rappel téléphonique convenu et daté part automatiquement

L'analyse date les rappels convenus (ADR 0011), mais l'opérateur devait encore lancer chaque appel. À sa demande du 06/10, le réveil compose désormais ces rappels à l'heure prévue, avec la fiche actuelle du prospect, l'historique et la version du script de l'appel où le rappel a été convenu. Mina sait qu'elle rappelle comme convenu ; l'accroche de prospection du premier appel n'est pas rejouée.

Le minuteur existant (`autocalled-reveil.timer`, toutes les cinq minutes) prend les rappels dus avant de reprendre les campagnes. Seuls les rappels issus d'un appel Bluetooth, entrant ou sortant, sont composés automatiquement. Les conversations navigateur et les simulations servent aux tests ; elles ne font pas sonner un téléphone par ce mécanisme. Un rappel sans date reste manuel. Le jour et le moment restent ceux du bilan : l'heure dite, sinon 9 h pour le matin ou le jour seul, 14 h pour l'après-midi, heure de Paris.

Les appels automatiques respectent la plage existante de 9 h à 19 h, tous les jours, et les garde-fous du pont. Ligne occupée, plafond atteint ou pont absent : le rappel attend un réveil suivant. Un prospect archivé ou un numéro en opposition n'est pas composé. Un appel sortant plus récent ou un appel entrant avec conversation solde le rappel, comme dans l'ADR 0011 ; l'éligibilité est relue juste avant la composition. Un verrou empêche deux réveils de composer le même rappel.

L'activation est explicite : `RAPPELS_AUTOMATIQUES_DEPUIS` contient un instant ISO. Absent ou illisible, rien ne part automatiquement. Un rappel prévu avant cet instant reste manuel, ce qui évite de composer les anciens rappels échus lors de la première activation. Une fois activé, un rappel échu pendant une interruption du serveur reste dû et repart au prochain réveil autorisé.

Un refus explicite du pont avant composition conserve le rappel. Si la réponse à une demande de composition est perdue et que le départ de l'appel reste incertain, on garde sa trace sans recommencer automatiquement : ne pas risquer deux appels pour le même rappel. Un rappel réellement composé est fait, que le prospect réponde ou non ; il n'ajoute pas de tentative à une campagne terminée.

## Considered Options

- Laisser les rappels à l'opérateur : ne répond pas à sa demande de rappel automatique.
- Recréer une campagne par rappel : rattacherait à une nouvelle file un geste déjà convenu et pourrait créer des tentatives supplémentaires sans réponse.
- Composer tous les rappels anciens dès l'installation : rappellerait à un autre moment que celui convenu, sans que l'opérateur ait repris ces anciennes demandes.
- Un minuteur par appel dans Next : perdu au redémarrage, alors que le réveil systemd existe déjà.

## Consequences

- Le rappel part au premier réveil autorisé après son échéance, avec jusqu'à cinq minutes de décalage, davantage si la ligne ou les plafonds le retiennent.
- Hors de la plage de 9 h à 19 h, il attend la prochaine ouverture de cette plage.
- La date se corrige toujours par réanalyse, pas par un champ manuel. Archiver le prospect empêche son rappel automatique.
- `pnpm reveil --essai` inclut les rappels qui seraient composés, en lecture seule ; le journal ne contient que des comptes et identifiants, aucun nom ni numéro.
