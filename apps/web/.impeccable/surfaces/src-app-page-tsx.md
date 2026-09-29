---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/globals.css","src/components/barre-haut.tsx","src/components/ligne-statut.tsx"]
---

# Accueil : régie de la journée

## Portée et mode

Route `/` (aujourd'hui une redirection vers `/entreprises`). Mode Operate : l'opérateur enchaîne jusqu'à une centaine d'appels par jour. Pendant une démo, la même page doit se lire par-dessus son épaule.

## Tâche

- Suivre l'appel en cours : qui Mina appelle, pour quelle entreprise, à quelle étape, ce qu'elle dit. Écouter ou prendre la main sans chercher le bouton.
- Voir où en est la journée : combien d'appels, lesquels sont allés loin, où se place l'appel en cours, ce qu'il reste dans la campagne.
- Retrouver un appel parmi 100 : filtre par issue, recherche dans les noms et les transcriptions, ouverture de la fiche d'appel.

## Direction retenue

Esquisse « G · Chivo, composants propres à Autocalled » du canevas https://claude.ai/artifact/H4YPF8euqRA5saeZCsfzL8, choisie le 29/09/2026 par l'opérateur. Elle descend de l'esquisse C « Sous-titres ». Le moment à retenir : la phrase de Mina au centre, en sous-titre, pendant que l'onde bouge.

Contrat à reprendre en commentaire d'ouverture au moment de construire :

- THÈSE : l'accueil est la régie de la journée, avec l'appel en cours en sous-titre, la journée en frise et les appels en liste filtrable. Il refuse le tableau de bord à cartes et chiffres-clés.
- MONDE : graphite chaud `#121110`, texte `#f2f0eb`, rouge antenne `#ff6a4d` pour ce qui vit. Chivo et Chivo Mono. Filets d'un pixel, actions en texte précédées de leur touche, filtres en texte souligné, recherche sur filet bas, coins de 6 px au plus.
- RÉCIT : l'opérateur voit l'appel en cours, situe la journée et retrouve n'importe quel appel en deux gestes. Le spectateur lit la phrase de Mina.
- PREMIER ÉCRAN : barre de 64 px ; bande d'appel en cours (identité à gauche, chrono et actions à droite, phrase centrée en 34 px, onde de 40 px) ; frise de 9 h à 19 h ; tableau des appels du jour, 38 px par ligne.
- FORME : esquisse G du canevas, choisie par l'opérateur parmi une vingtaine ; pas de tirage `concept-seed`.

## Décisions ouvertes

1. Sans appel en cours (ligne libre, pont arrêté, téléphone déconnecté), que montre la bande du haut ?
2. Hauteur des traits de la frise : l'issue de l'appel (maquette) ou l'étape atteinte du bilan, plus fidèle à « jusqu'où l'appel est allé » ?
3. Raccourcis clavier `E`, `Espace`, `/` : sur l'accueil seulement ou dans toute l'app ?
4. Bascule du thème : toute l'app passe en sombre avec Chivo, ou l'accueil d'abord ?
5. Frise et tableau sous 640 px.
6. `DESIGN.md` et `.impeccable/design.json` décrivent encore l'ancienne direction claire. L'agent documentaliste les régénère après la construction, pas avant.
