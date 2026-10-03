# Le pont prête la ligne à un service local, sans cesser d'être le seul à la tenir

Le téléphone passerelle est le seul moyen de passer un vrai appel depuis la machine, et le pont le seul à le piloter (ADR 0007). Un autre service de la même machine peut avoir besoin d'appeler, avec son propre agent ElevenLabs et sa propre suite à donner à l'appel, sans rien avoir à faire avec les prospects, les campagnes ou la base d'Autocalled. Lui ouvrir un second chemin vers le téléphone ferait deux maîtres pour une seule ligne.

Le pont prête donc sa ligne. Un `POST /appels` peut porter trois champs facultatifs :

- `agentId` : l'agent ElevenLabs de cet appel, à la place de celui d'Autocalled ;
- `rappels` : l'adresse où le pont rappelle pour cet appel (`<rappels>/<appelId>/conversation`, `/outils` et `/fin`), avec les mêmes corps et le même secret que les routes `/api/pont/appels/<appelId>/…` de l'application ;
- `horsPlafond` : l'appel ne compte pas au plafond.

Tout outil client que le pont ne connaît pas est relayé à `…/outils` de l'appel, comme les outils d'agenda : un agent qui n'est pas celui d'Autocalled garde ses propres outils.

Les appels entrants suivent la même idée. `RELAIS_ENTRANTS` liste des numéros et l'adresse d'un service (`+33…,+33…=http://127.0.0.1:<port>/…`). Quand l'un de ces numéros appelle, le pont pose d'abord la question à ce service, avec le même contrat que `/api/pont/entrants` (ADR 0018) et le numéro en E.164. Le service a 1,5 s. S'il ne prend pas l'appel (refus, erreur, réponse illisible ou délai dépassé), l'application d'Autocalled décide comme avant, dans le temps qui reste sur les 3 s.

L'adresse de rappel et celle du relais doivent être locales (`http://127.0.0.1:<port>/…` ou `http://localhost:<port>/…`, avec un port) : le pont y envoie son secret et la parole de l'appel. Toute autre adresse est refusée (400 pour un `POST /appels`, décision illisible pour un relais).

Absents, ces champs laissent tout comme avant : l'agent d'Autocalled, les routes de l'application, le plafond compté.

## Considered Options

- Donner au service son propre accès au téléphone : deux programmes piloteraient la même liaison Bluetooth, et chacun pourrait composer par-dessus l'appel de l'autre.
- Faire passer ces appels par l'application d'Autocalled, comme des appels de prospects : il faudrait une fiche, une entreprise et une version de script pour un appel qui n'en a pas, et le bilan les analyserait comme un démarchage.
- Accepter n'importe quelle adresse de rappel : le pont enverrait son secret et la parole de l'appel hors de la machine à qui détient ce secret.
- Laisser le service lire les appels entrants à la place du pont : il ne voit pas le téléphone, et l'application perdrait les rappels de ses prospects.

## Consequences

- Le pont reste l'arbitre de la ligne : `/etat` dit à tous si elle est occupée, et une composition pendant un autre appel, prêté ou non, reçoit 409. Un service qui emprunte la ligne lit `/etat` avant d'appeler et attend son tour.
- `horsPlafond` ne déplace pas la frontière de sécurité : celui qui détient `PONT_SECRET` peut déjà tout commander au pont. Le plafond reste un garde-fou contre les rafales de démarchage, que ces appels ne sont pas.
- Le son d'un appel prêté n'est pas gardé : aucune durée de conservation d'Autocalled (ADR 0014) ne connaît cet appel. Le pont efface son `.wav` de `data/pont` une fois la fin envoyée et ne donne pas son chemin dans le bilan ; il garde son journal `.log`, sans parole ni numéro en clair.
- La fin d'un appel prêté ne relance pas les campagnes : l'application ne l'apprend pas. Une campagne qui attendait la ligne reprend au réveil suivant, dans les 5 minutes (ADR 0017).
- Un outil client inconnu, sur un appel d'Autocalled, part maintenant à `/api/pont/appels/<id>/outils`, qui le refuse : l'agent entend une phrase neutre (« Cet outil ne répond pas pour l'instant. ») au lieu d'une erreur du SDK.
- `RELAIS_ENTRANTS` mal écrite est signalée au journal, sans numéro, et le pont démarre sans relais.
