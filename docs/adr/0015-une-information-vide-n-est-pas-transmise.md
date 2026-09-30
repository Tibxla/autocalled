# Une information vide n'est pas transmise à l'assistante

Chaque champ vide de la fiche d'une entreprise partait avec un texte par défaut : « à présenter simplement. » pour l'offre, « les professionnels. » pour la cible, « à tirer de la conversation. » pour les arguments, « pas de consigne particulière. » pour le prix, « rien de particulier. » pour les interdits. Ces textes parlaient à la place de l'opérateur : « les professionnels » inventait une cible, et « pas de consigne particulière » pouvait se lire comme le droit de donner un chiffre. L'opérateur voulait aussi donner à l'assistante des informations propres à une entreprise (« Parking : gratuit devant le gîte ») sans qu'Autocalled ait un champ pour chacune.

Un champ vide de la fiche de l'entreprise (offre, cible, arguments, consigne de prix, interdits, informations complémentaires) part désormais en variable vide. ElevenLabs exige que toutes les variables du prompt existent : la variable est là, sa valeur est vide. Le prompt donne chaque information sur sa ligne, après son libellé, et pose une consigne générale : quand rien ne suit les deux-points, l'information n'est pas donnée, l'assistante n'en parle pas et ne l'invente pas ; les règles du prompt s'appliquent toujours.

La fiche gagne un seul champ de texte libre, « Informations complémentaires » (colonne `complements`, variable `entreprise_complements`, 1 500 caractères au plus), que l'assistante n'emploie que si la conversation y mène. Il suit les règles des autres champs de la fiche : même schéma de saisie pour l'interface et le MCP, garde contre les écritures concurrentes (ADR 0012), confirmation de l'opérateur pendant une campagne téléphone en cours de l'entreprise (ADR 0010).

## Considered Options

- Des champs que l'opérateur ajoute et supprime (un libellé, une valeur) : une structure à tenir dans l'interface, le MCP, l'aperçu et le prompt pour un contenu qu'un texte libre porte aussi bien, et un prompt qui s'allonge à chaque champ. Écartée par l'opérateur.
- Garder les textes par défaut : ils donnent à l'assistante une consigne que personne n'a écrite.
- Retirer du prompt la ligne d'un champ vide : le prompt est fixe chez ElevenLabs et seules les valeurs des variables changent d'un appel à l'autre. Il faudrait composer le prompt dans l'application.
- Envoyer « non renseigné » : un mot que l'assistante pourrait répéter au prospect. Gardé en repli si ElevenLabs refuse une variable vide.

## Consequences

- Interdits vides : plus aucune interdiction propre à l'entreprise, mais les règles générales du prompt restent (aucune promesse d'envoi, aucun créneau inventé, aucun fait inventé, refus ferme, question « êtes-vous une IA »). « rien de particulier. » n'en disait pas plus.
- Offre vide : l'assistante ne connaît que le nom de l'entreprise. Elle dit qu'elle ne sait pas et propose d'en parler au rendez-vous ; le script peut encore porter le discours. La page de l'entreprise (« Offre à écrire ») et l'aperçu le signalent, le lancement d'une campagne n'est pas bloqué.
- Prix vide : l'assistante renvoie au rendez-vous, ce qui est plus sûr qu'avant. Arguments vides : le temps « Argumenter » de la méthode CRAC s'appuie sur ce que dit le prospect.
- L'aperçu « Ce que l'assistante recevra » et `apercu_variables_appel` montrent un champ vide comme non renseigné, non transmis (`nonTransmis`) ; `parDefaut` ne garde que les vrais textes par défaut.
- Hors de cette règle : l'interlocuteur vide garde « un membre de l'équipe », dont la phrase du rendez-vous a besoin, et l'aide du formulaire le promet ; les champs du prospect (rôle, société, contexte, e-mail), l'historique, les étapes et les objections gardent leurs textes par défaut. Le premier message par défaut, « Allô ? », ne cite aucune variable de la fiche ; un premier message personnalisé qui en citerait une laisserait un trou, visible dans l'aperçu du premier message.
- Mise en ligne dans cet ordre : migration 0016, déploiement de l'application, qui envoie `entreprise_complements`, puis `pnpm agent push` aussitôt, sans aucun appel entre les deux. Un prompt qui cite une variable que l'application n'envoie pas empêche ElevenLabs d'ouvrir la conversation (ADR 0010). Le pont n'a pas à redémarrer : il transmet les variables reçues de l'application telles quelles, sans liste ni filtre, comme la ligne navigateur et la simulation.
- Personne n'a vérifié qu'ElevenLabs accepte une variable présente mais vide : c'est à confirmer au premier appel de test. Si elle est refusée, un champ vide part en « non renseigné » et la consigne du prompt dit que ce mot veut dire que l'information n'existe pas.
