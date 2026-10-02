# Un prospect qui ne répond pas est rappelé le lendemain, au moment opposé de la journée, trois fois au plus

Un appel de campagne sans réponse passait l'entrée du prospect à « appelée », et la campagne continuait. Sur la ligne téléphone, la plupart des appels finissent ainsi : pas de décroché, messagerie, répondeur, filtre d'appel du téléphone. Chacun de ces prospects était perdu pour la campagne, à moins que l'opérateur ne le rajoute à la main dans une autre.

Un appel qui finit en issue système `non-abouti` donne lieu à une **nouvelle tentative**, jusqu'à trois tentatives par prospect et par campagne, la première comprise (`TENTATIVES_MAX`). Le sens de `non-abouti` donné à l'analyse est précisé : personne n'a vraiment répondu, même si l'assistante a dit quelques mots à un répondeur ou à un filtre d'appel. La version des consignes d'analyse passe à « consignes v3 », un seul changement de version pour cette précision et pour les appels entrants (ADR 0018).

La nouvelle tentative part le lendemain, au moment opposé de la journée, heure de Paris : un appel fini avant 13 h est retenté le lendemain à 14 h, un appel fini à partir de 13 h le lendemain à 9 h (les heures des rappels datés, ADR 0011). Le calcul part de la fin de l'appel (`finLe`). Le lendemain est un jour calendaire, week-end compris : les hébergements que démarchent les entreprises travaillent le samedi et le dimanche.

Les tentatives vivent dans l'entrée du prospect, qui garde sa place dans la file. L'entrée repasse « à appeler » avec le numéro de la tentative, l'instant avant lequel on ne compose pas (`pasAvant`) et les appels des tentatives passées. La campagne appelle le premier prospect **dû** dans l'ordre de la file : une tentative arrivée à son heure passe avant les prospects plus bas. Quand rien n'est dû, elle attend la plus proche tentative prévue.

L'issue d'un appel qui a eu une conversation n'est connue qu'après l'analyse, une à trois minutes plus tard (ADR 0005). Entre-temps, l'entrée est **en analyse** : la file continue, mais la campagne ne peut pas se terminer, puisque ce bilan peut encore remettre le prospect en file. À la fin de l'appel, l'application relit l'appel sous le verrou de la campagne : issue déjà connue (fin sans conversation, simulation), l'entrée est classée tout de suite ; appel en échec, elle passe « appelée » ; sinon elle attend son bilan. Après l'écriture du bilan ou son échec, l'appel est classé dans sa campagne (`classerDansSaCampagne`), qui repart si quelqu'un est dû. Le classement n'agit que sur une entrée en analyse : une réanalyse ne touche plus la file. Une analyse en échec ne donne aucune nouvelle tentative.

Rien ne relançait une campagne en dehors de la fin d'un appel. Un minuteur systemd, `autocalled-reveil.timer`, lance toutes les 5 minutes `scripts/reveil-campagnes.ts` (`pnpm reveil`), hors de Next comme la purge (ADR 0014). Le réveil classe les entrées restées en analyse alors que leur appel a déjà son bilan ou a échoué (un classement perdu), relit l'agenda si sa copie a plus de dix minutes, puis relance une à une les campagnes téléphone en cours, sans appel en ligne, qui ont quelqu'un de dû. Jamais une campagne en pause. `pnpm reveil --essai` dit ce qu'il ferait, dans une transaction Postgres en lecture seule.

## Considered Options

- Une nouvelle entrée en fin de file pour chaque tentative : le prospect perd sa place, apparaît deux ou trois fois dans les comptes, et son historique se lit sur plusieurs lignes.
- Une table des tentatives à part : une migration, et deux endroits à tenir d'accord pour une file qui vit dans la campagne.
- Retenter le jour même, quelques heures plus tard : des rafales d'appels sans réponse vers les mêmes numéros sont ce qui fait signaler une ligne comme démarchage (ADR 0007).
- La même heure le lendemain : quelqu'un d'indisponible le matin l'est souvent tous les matins.
- Jours ouvrés seulement : un samedi sans réponse attendrait le lundi, alors que les hébergements travaillent le week-end.
- Décider « sans réponse » à la fin de l'appel, d'après sa durée ou l'absence de conversation : un répondeur ou un filtre d'appel décroche, et la conversation ElevenLabs existe. Seule l'analyse le distingue.
- Un minuteur dans le processus de l'interface : perdu à chaque redémarrage, et `after()` n'existe que pendant une requête.

## Consequences

- Une campagne reste en cours jusqu'à deux jours après son dernier prospect : elle n'est terminée que s'il ne reste personne à appeler (tentatives à venir comprises), ni appel en ligne, ni appel en analyse.
- Le réveil n'a pas de plage horaire : seules les nouvelles tentatives sont calées à 9 h et 14 h. Toute campagne téléphone en cours avec quelqu'un de dû repart dans les 5 minutes, y compris un enchaînement arrêté depuis des jours. `pnpm reveil --essai` avant la première installation du minuteur.
- Une tentative compte au plafond du pont comme tout appel sortant. Plafond atteint, la campagne se met en pause et le réveil ne la reprend pas : c'est à l'opérateur.
- Ligne occupée (un autre appel, ou un prospect qui rappelle, ADR 0018) : rien ne part et aucun prospect n'est consommé ; la fin de cet appel ou le réveil reprennent. `lancer_campagne` sur une ligne occupée laisse donc la campagne en cours jusqu'au prochain réveil.
- La simulation et la ligne navigateur suivent la même règle de domaine, mais le réveil ne relance que la ligne téléphone : une simulation s'arrête quand plus rien n'est dû, ses tentatives restent en file, et elle se relance à la main.
- Sauter, retirer et reporter acceptent une tentative à venir et gardent son historique. Terminer une campagne retire aussi les tentatives à venir et tient pour appelé un appel en analyse. Un geste sur une entrée en analyse est refusé, avec un message qui le dit.
- Terminer est accepté pendant un appel en ligne, même quand personne n'attend dans la file : la fin demandée est notée sur l'entrée de cet appel (`finDemandee`, trace du geste), qu'elle garde en analyse ; son issue, même sans réponse, ne crée alors pas de nouvelle tentative.
- Un prospect qui rappelle et parle à l'assistante voit sa tentative prévue retirée, motif `rappel-entrant`, par l'application (ADR 0018).
- Comptes de campagne : un appel en analyse compte parmi les prospects traités, et à part (`enAnalyse`) ; les tentatives à venir sont comptées parmi les prospects à appeler, et à part (`aRetenter`).
- Un prospect archivé pendant l'analyse de son appel peut revenir en file par le classement ; à son tour, il n'est pas appelé et l'entrée devient « non appelable », un libellé inexact.
- Une entrée dont l'appel reste bloqué en traitement n'est pas débloquée par le réveil : `relancer_analyse` la classe. Une réanalyse, même lancée depuis Claude Code, peut ainsi faire repartir une campagne téléphone.
