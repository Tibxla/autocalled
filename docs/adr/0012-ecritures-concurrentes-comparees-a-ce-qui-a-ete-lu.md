# Écritures concurrentes : chacun compare à ce qu'il a lu, personne ne verrouille

L'opérateur et Claude Code écrivent dans les mêmes fiches : l'un dans le navigateur, l'autre par le serveur MCP, parfois au même moment. Sans garde, un formulaire ouvert avant une écriture de Claude Code l'effacerait à l'enregistrement, sans que personne le voie.

Chaque écriture porte ce qu'elle a lu : l'horodatage de dernière modification d'une fiche d'entreprise ou d'une objection (`modifie_le`, avec son origine `modifie_par`), le numéro de la dernière version d'un script, l'empreinte des fichiers de `agent/`, la fiche d'un prospect. Si la donnée a changé depuis, l'écriture est refusée, avec l'auteur et l'heure (« Fiche modifiée par Claude Code à 14:02 ») ; la saisie reste en place, et l'opérateur recharge ou écrase en connaissance de cause. Le serveur MCP passe la même valeur (`connu`, `empreinteConnue`) et, sans elle, compare à ce qu'il a lu au début de l'outil. La comparaison et l'écriture se font sous verrou de ligne, dans une même transaction.

## Considered Options

- Un verrou pris à l'ouverture du formulaire : un onglet oublié bloquerait Claude Code, et il faudrait une expiration et un moyen de forcer.
- Le dernier qui écrit gagne : c'était le comportement d'avant, qui perd une écriture sans rien dire.
- Une fusion champ par champ : illisible pour un texte libre comme le prompt ou une réponse CRAC.

## Consequences

- Les migrations ajoutent `modifie_le` et `modifie_par` aux entreprises et aux objections, et `cree_par` aux versions de script.
- Réordonner les objections ne change pas leur `modifie_le` : un ordre modifié ne bloque pas un formulaire ouvert.
- Écraser reste possible, en un geste, avec la valeur rendue par le refus : la garde prévient, elle n'interdit pas.
