# Un prospect qui rappelle est décroché par l'assistante ; un numéro inconnu sonne jusqu'à la messagerie

Le numéro du téléphone passerelle s'affiche chez chaque prospect appelé, et celui qui a manqué l'appel rappelle. Le pont refusait le canal son de tout appel qu'il n'avait pas composé (ADR 0007) : le téléphone sonnait dans le vide, puis tombait sur sa messagerie, que personne n'écoute. Avec les nouvelles tentatives (ADR 0017), les appels manqués, et donc les prospects qui rappellent, deviennent plus nombreux.

L'assistante décroche elle-même quand c'est un prospect connu. Le pont voit l'appel arriver (`CallAdded` en état `incoming` ou `waiting`) et lit le numéro de l'appelant (`LineIdentification`, dans `CallAdded` ou plus tard, deux secondes d'attente au plus). Un numéro masqué ou absent sonne. Le pont ne pose la question que si la ligne est libre : aucun appel suivi, et aucun appel précédent encore en train d'envoyer sa fin à l'application. Un appel arrivé pendant un autre n'est jamais évalué, même si cet autre finit pendant qu'il sonne.

La question part à l'application, `POST /api/pont/entrants` avec le numéro brut, servie en local seulement et gardée par le secret du pont (ADR 0007). Le pont attend trois secondes au plus ; une erreur, un délai dépassé ou une réponse incomplète le font laisser sonner. L'application normalise le numéro et décroche seulement un **prospect connu** : numéro appelable (hors liste d'opposition, ADR 0013), prospect non archivé, au moins un vrai appel sortant vers lui, sur la ligne téléphone ou Twilio (la ligne navigateur et la simulation ne font sonner aucun téléphone). Plusieurs prospects sur ce numéro, dans une ou plusieurs entreprises : celui dont le dernier appel sortant est le plus récent. Un appel téléphone encore en cours en base depuis moins d'une heure fait aussi laisser sonner. Sinon, l'application enregistre l'appel avant de répondre (sens `entrant`, ligne téléphone, sans campagne, numéro de l'appelant, version du script du dernier appel sortant), puis renvoie de quoi ouvrir la conversation. Le pont enverra toujours une fin pour cette ligne, même s'il ne parvient pas à décrocher. Pour un numéro inconnu, rien n'est écrit.

Laisser sonner, c'est ne rien faire : ni `Answer` ni `Hangup`, qui rejetterait l'appel et enverrait l'appelant sur la messagerie à la première sonnerie. Décroché, l'appel suit le chemin d'un appel sortant : suivi en direct, écoute, prise de main, bilan. Il ne compte pas au plafond, qui ne compte que les compositions, et n'est jamais recomposé ni relancé après une panne : un échec le termine. L'assistante parle la première, aussitôt la ligne ouverte : « Allô, oui bonjour, {nom de l'assistante} à l'appareil. », sans le nom du prospect, qui n'est peut-être pas la personne au bout du fil quand le numéro est partagé.

Le prompt ne pouvait dire que « Tu as appelé {prospect}, qui ne t'attendait pas. ». Cette phrase devient une variable, `situation_appel`, envoyée par toutes les lignes (ElevenLabs exige toutes les variables du prompt) ; un appel sortant garde la même phrase. Pour un appel entrant, l'application la compose : « C'est {prospect} qui te rappelle, après ton appel d'hier, resté sans réponse. Tu viens de décrocher en te présentant : remercie pour ce rappel, puis reprends ton plan là où il en est. » Le jour s'écrit « d'aujourd'hui », « d'hier » ou « du 2 octobre » dans le fuseau de l'entreprise, « resté sans réponse » seulement si le dernier appel sortant était non abouti, sans accord de genre. L'analyse sait que le prospect a rappelé : elle ne reproche pas l'ouverture, et une conversation n'est jamais « non abouti » (consignes v3, ADR 0017).

## Considered Options

- Ne jamais décrocher : le prospect qui rappelle tombe sur une messagerie que personne n'écoute, alors qu'il rappelle de lui-même.
- Décrocher tous les appels : un inconnu, ou une personne effacée, parlerait à une IA au nom d'une entreprise prise au hasard, et Autocalled écrirait en base le numéro de quelqu'un qui n'a rien demandé.
- Rejeter un numéro inconnu (`Hangup`) : la messagerie répond aussitôt, et l'appelant comprend qu'on a refusé son appel.
- Laisser le pont décider, d'après une liste de numéros : il ne lit jamais la base (ADR 0007), et la liste serait une copie de plus des numéros des prospects.
- Un premier message qui nomme le prospect : faux quand le numéro est celui d'un standard ou d'un associé.

## Consequences

- Après l'analyse d'un appel entrant avec une issue autre que « non abouti », la tentative prévue du prospect est retirée de toute campagne non terminée de son entreprise (motif `rappel-entrant`, par l'application). Sinon, l'assistante le rappellerait le lendemain alors qu'il vient de lui parler.
- Un appel entrant solde un rappel convenu (ADR 0011) seulement s'il a eu une conversation.
- Le plafond du pont et les compteurs de l'accueil ne comptent que les appels sortants.
- Le téléphone n'a pas pu décrocher (refus d'`Answer`, appelant parti avant, panne du pont) : l'appel finit `non-abouti`, sans conversation, ne retire aucune tentative et ne solde aucun rappel convenu.
- Tant qu'un appel entrant sonne ou dure, la ligne est occupée : le pont répond 409 à une composition, et une campagne téléphone attend. À la fin d'un appel entrant, après la pause entre deux appels, l'application relance les campagnes téléphone qui ont quelqu'un de dû, comme le réveil ; si le pont dit encore la ligne occupée, c'est le réveil qui reprend, dans les 5 minutes.
- `/etat` du pont dit `entrantEnCours` de la sonnerie à la fin de l'appel entrant, et le `sens` de l'appel en cours ; `appelEnCours` est vrai dès la sonnerie, quand `appelId` est encore vide.
- Avant de décrocher, l'appelant entend sonner jusqu'à cinq secondes de plus : deux pour le numéro, trois pour la question.
- Un appel resté « en cours » en base après un redémarrage du pont fait laisser sonner les appels entrants pendant une heure. Une décision arrivée au pont après ses 3 s laisse une ligne entrante sans fin : le réveil la passe en échec au bout de 10 minutes.
- Un sel d'opposition changé ou perdu (`opposition-illisible`) fait laisser sonner tous les appels entrants, sans autre signe qu'au journal du pont (« numéro inconnu de l'application »).
- Trou accepté : un prospect qui rappelle pendant l'analyse de l'appel sortant qu'il a manqué parle à l'assistante, mais ce bilan pose ensuite une nouvelle tentative que le retrait n'a pas pu voir.
- Raccrocher un appel sortant avant que le téléphone ait confirmé la composition passe encore par `HangupAll`, qui rejetterait un appel entrant arrivé dans ces quelques secondes.
- L'analyse des versions de script ne compte que les appels sortants : un prospect qui rappelle n'a pas entendu l'accroche de la version.
