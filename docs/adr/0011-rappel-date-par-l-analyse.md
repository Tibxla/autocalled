# Un rappel convenu est daté par l'analyse, et fait dès le prochain appel

Quand un prospect demande à être rappelé, l'opérateur doit savoir quand. Le bilan gardait le moment tel que le prospect l'avait dit (« jeudi matin ») : impossible de trier, ni de dire ce qui est à faire aujourd'hui. Le bilan gagne donc un champ `rappelLe`, rempli par l'analyse isolée (ADR 0005) à partir de la date de l'appel : un jour, et une heure ou un moment de la journée seulement si le prospect les a dits. Un moment vague (« la semaine prochaine »), ou proposé par l'assistante sans accord du prospect, reste sans date. Le domaine refuse une date hors d'un rappel convenu, antérieure à l'appel, à plus d'un an ou qui n'existe pas. La base garde l'instant retenu (l'heure dite, 9 h pour le matin ou un jour seul, 14 h pour l'après-midi, heure de Paris), réécrit à chaque analyse, pour trier et filtrer.

Un rappel est fait dès qu'un appel plus récent part vers le même prospect, qu'il décroche ou non. Il n'y a pas de case à cocher : le geste qui fait le rappel est l'appel lui-même. Les appels simulés n'entrent pas dans la règle.

## Considered Options

- Une date saisie par l'opérateur après l'appel : un geste de plus sur chaque rappel, et la date ne dirait plus ce que le prospect a dit.
- Une date corrigeable par le serveur MCP : le modèle qui vient de lire la transcription pourrait la réécrire sous l'effet d'une consigne glissée par le prospect. On relance l'analyse, qui refait le bilan entier.
- Un événement d'agenda par rappel : un rendez-vous est réservé avec le prospect, un rappel ne l'est pas ; les mélanger fausserait les créneaux libres.
- Un rappel fait à la main : il resterait à faire après un rappel manqué, ou disparaîtrait sans appel.

## Consequences

- Les bilans antérieurs restent valides, sans date ; la version des consignes d'analyse change, et une analyse relancée date les anciens rappels.
- L'accueil liste « À rappeler aujourd'hui » et les rappels en retard ; la liste des appels filtre les rappels à faire (`?rappels=1`), et le MCP les lit par `rappels_du_jour` et `lister_appels`.
- Une date mal comprise ne se corrige qu'en relançant l'analyse, ou en rappelant le prospect.
- Révoquer un numéro retire ses rappels à faire.
