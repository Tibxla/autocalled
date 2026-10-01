# Démo fermée : l'assistante n'appelle que des personnes prévenues

Depuis le 2 août 2026 (AI Act, art. 50), une IA qui parle à quelqu'un doit l'en informer, et le droit français impose de prévenir une personne qu'elle est enregistrée. Le projet sert à démontrer un savoir-faire, pas à prospecter : Autocalled n'a qu'un opérateur, qui n'appelle que lui-même et des proches qu'il a prévenus qu'une IA les appellera et que l'appel sera enregistré.

Cette information se donne avant l'appel, hors d'Autocalled, qui n'en garde aucune trace. Juste avant de composer, le serveur vérifie seulement que le numéro est valide et absent de la liste d'opposition (ADR 0013) : c'est l'opérateur qui garantit que la personne est prévenue. L'assistante peut alors parler comme une humaine, sans s'annoncer comme IA ni annoncer l'enregistrement, parce que chaque personne appelée le sait déjà.

Ce choix ne tient que dans une démo fermée. Pour démarcher de vrais prospects, l'annonce « IA » et l'annonce de l'enregistrement devraient se faire dans l'appel, et il faudrait en plus un chantier de conformité au démarchage téléphonique (Bloctel, opposition, plages horaires, numéro NPV), volontairement hors périmètre.

## Consequences

- Une fiche importée, par l'interface ou par Claude Code, est appelable aussitôt.
- Pour ne plus appeler quelqu'un, on archive son prospect ; s'il demande l'effacement de ses données, on efface la personne, et son numéro entre dans la liste d'opposition (ADR 0013).
- Le système ne protège pas d'une erreur de l'opérateur : appeler une personne qu'il n'a pas prévenue reste possible, et c'est à lui de l'éviter.
