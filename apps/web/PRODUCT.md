# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Un seul utilisateur connecté : l'opérateur (le créateur du projet). Il prépare des entreprises et des prospects, lance des campagnes d'appels (jusqu'à une centaine par jour) et relit les bilans, souvent pendant une démonstration, devant quelqu'un qui regarde l'écran par-dessus son épaule (recruteur, client potentiel). Second public, indirect : les visiteurs du dépôt GitHub public, qui verront les captures d'écran.

## Product Purpose

Autocalled fait passer de vrais appels de prospection par Mina, une assistante vocale IA, sur un vrai réseau mobile, puis garde l'enregistrement et un bilan de chaque appel. C'est une démonstration de savoir-faire, pas un outil commercial : le succès, c'est qu'une démo en direct (le téléphone sonne, Mina parle, le rendez-vous apparaît dans l'agenda, le bilan tombe) convainque celui qui regarde.

## Positioning

La même assistante représente plusieurs entreprises et change de discours selon l'entreprise et le prospect ; chaque affirmation d'un bilan est reliée à la phrase exacte de la transcription ; les versions de script se comparent avec une garde honnête sur la taille de l'échantillon.

## Operating Context

- Interface servie uniquement sur le tailnet de l'opérateur, derrière `tailscale serve` ; aucun écran de connexion.
- Les prospects arrivent par import de fichiers Markdown (un fichier par prospect, en-tête YAML + contexte libre), appelables aussitôt : l'opérateur n'appelle que des personnes prévenues (ADR 0001).
- Un seul appel à la fois (un seul téléphone passerelle) ; une campagne enchaîne les prospects, jusqu'à une centaine d'appels par jour, sous le plafond horaire et journalier du pont.
- Langue de l'interface et du domaine : français.

## Capabilities and Constraints

- Vocabulaire imposé par `CONTEXT.md` à la racine du dépôt (Entreprise, Prospect, Fiche prospect, Objection, CRAC, Script, Étape, Version de script, Issue, Bilan, Campagne, Numéro appelable…).
- Écrans en place : Entreprises (fiche, prospects, objections, scripts, issues, campagnes, analyse), Appels (liste et fiche d'appel avec écoute et prise de main), Campagne en direct, Téléphone, Réglages. Reste à faire : l'accueil, régie de la journée (aujourd'hui la racine redirige vers Entreprises).
- Toute liste d'appels reste lisible, filtrable et cherchable à 100 appels par jour : une vue qui ne tient qu'avec quelques appels ne convient pas.
- Une version de script est figée : la modifier crée la version suivante. Une objection s'archive, elle ne se supprime pas.
- Un numéro invalide ou d'une personne effacée n'est jamais composé.

## Brand Commitments

- Nom du produit : Autocalled. Nom de l'assistante : Mina.
- Direction visuelle fixée par l'opérateur dans `docs/direction-visuelle.md` : régie d'écoute sombre, dense et pilotée au clavier, sans esthétique « générée par IA » (choisie le 29/09/2026, remplace la direction claire d'origine).

## Evidence on Hand

Premiers vrais appels passés sur la ligne téléphone le 28/09/2026 ; aucun client, aucun chiffre publiable. Rien des vrais appels (transcription, réplique, adresse) ne va dans le dépôt public ni dans les captures. Les données d'exemple sont fictives (entreprise « Atelier Vitrine », numéros de la tranche fictive ARCEP 06 39 98). Ne jamais inventer de témoignage, de statistique ou de résultat.

## Product Principles

1. La démo en direct est le moment de vérité : ce qui se voit pendant un appel passe avant tout le reste.
2. Honnêteté des chiffres : toujours montrer le nombre d'appels, jamais de gagnant sur un petit échantillon.
3. Chaque affirmation se justifie : une objection levée montre la phrase qui le prouve.
4. Le vocabulaire du domaine partout, identique dans le code, l'interface et la doc.
