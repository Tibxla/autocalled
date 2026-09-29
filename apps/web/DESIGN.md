---
name: Autocalled
description: Régie de Mina, l’assistante vocale de prospection ; interface opérateur sombre, dense, pilotée au clavier.
colors:
  fond: "#121110"
  surface: "#191816"
  survol: "#1c1b19"
  encre: "#f2f0eb"
  encre-2: "#c9c5bd"
  encre-3: "#8b877f"
  trait: "#6b6862"
  trait-2: "#55524c"
  grille: "#1c1b19"
  filet: "#211f1d"
  filet-2: "#2a2926"
  filet-fort: "#3a3935"
  souligne: "#4a4843"
  antenne: "#ff6a4d"
  alerte: "#b98468"
  alerte-fond: "#221812"
  focus: "#f2f0eb"
typography:
  sous-titre:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 500
    lineHeight: "2.625rem"
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  section:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  lecture:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "Chivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  donnees:
    fontFamily: "Chivo Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  touche:
    fontFamily: "Chivo Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  trace: "2px"
  touche: "3px"
  action: "4px"
  bloc: "6px"
  full: "9999px"
spacing:
  gouttiere-mobile: "16px"
  gouttiere: "32px"
  gouttiere-large: "48px"
  champ: "6px"
  action-x: "6px"
  filtres: "22px"
  ligne: "38px"
  controle: "36px"
  barre: "64px"
components:
  action-forte:
    textColor: "{colors.encre}"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "0 6px"
    height: "36px"
  action-normale:
    textColor: "{colors.encre-2}"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "0 6px"
    height: "36px"
  action-normale-hover:
    textColor: "{colors.encre}"
  action-discrete:
    textColor: "{colors.encre-3}"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "0 6px"
    height: "36px"
  action-discrete-hover:
    textColor: "{colors.encre-2}"
  action-alerte:
    textColor: "{colors.alerte}"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "0 6px"
    height: "36px"
  touche:
    textColor: "{colors.encre-3}"
    typography: "{typography.touche}"
    rounded: "{rounded.touche}"
    padding: "0 5px"
    height: "18px"
  touche-forte:
    textColor: "{colors.encre}"
  saisie:
    textColor: "{colors.encre}"
    typography: "{typography.body}"
    padding: "0"
    height: "36px"
  zone-texte:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.encre}"
    typography: "{typography.lecture}"
    rounded: "{rounded.bloc}"
    padding: "8px 12px"
  recherche:
    textColor: "{colors.encre}"
    typography: "{typography.body}"
    height: "30px"
    width: "300px"
  filtre:
    textColor: "{colors.encre-3}"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "4px 0"
  filtre-actif:
    textColor: "{colors.encre}"
  lien-nav:
    textColor: "{colors.encre-3}"
    typography: "{typography.body}"
    height: "40px"
  lien-nav-actif:
    textColor: "{colors.encre}"
  ligne-table:
    textColor: "{colors.encre}"
    typography: "{typography.body}"
    height: "38px"
  ligne-table-hover:
    backgroundColor: "{colors.survol}"
  message-neutre:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.encre-2}"
    typography: "{typography.label}"
    rounded: "{rounded.bloc}"
    padding: "10px 14px"
  message-alerte:
    backgroundColor: "{colors.alerte-fond}"
    textColor: "{colors.alerte}"
    typography: "{typography.label}"
    rounded: "{rounded.bloc}"
    padding: "10px 14px"
  confirmation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.encre}"
    rounded: "{rounded.bloc}"
    padding: "12px 14px"
---

# Design System: Autocalled

## Overview

**Creative North Star: "La régie qui se tait"**

L’interface opérateur d’Autocalled est une régie d’écoute sombre : un poste de travail sur graphite chaud, fait pour enchaîner une centaine d’appels par jour et pour être lu par-dessus l’épaule pendant une démo. L’écran se tait jusqu’à ce qu’un appel vive. Tout est en neutres chauds, du graphite du fond au blanc cassé du texte ; la hiérarchie vient de la graisse, de la taille et de trois niveaux d’encre. Une seule couleur a le droit de vivre : le rouge « antenne », sur l’appel en cours, la voix de Mina, le point du logo et la position de l’appel sur la frise. Tant que rien ne sonne, il est absent.

La densité est assumée : barre de 64 px, puis le contenu en pleine largeur, des tableaux à lignes de 38 px séparées par des filets d’un pixel, des comptes en chasse fixe dans les filtres et les lignes. Le clavier passe d’abord : chaque action est un texte précédé de sa touche (`E Écouter`, `Espace Prendre la main`, `/` pour chercher), les filtres sont du texte souligné quand ils sont actifs, les champs sont des filets bas. Le soin tient aux détails : filets fins, alignements exacts, soulignements décalés de 4 px, focus qui ne décale rien.

Deux éléments signature portent le monde. Pendant un appel, la phrase de Mina s’affiche au centre en sous-titre, au-dessus de la piste de parole (une barre par mot, Mina en antenne au-dessus de l’axe, le prospect en gris dessous). Sur la journée, une frise de 9 h à 19 h pose un trait par appel, dont la hauteur dit l’étape atteinte et le blanc un rendez-vous pris.

Rejets confirmés par la direction (`docs/direction-visuelle.md`) : dégradés violet-bleu, halos et lueurs colorées, verre dépoli, quasi-noir à bords brillants ; les polices par défaut des générateurs (Inter, Geist, JetBrains Mono, IBM Plex…) ; la paire bouton plein et bouton contour, les filtres en puces encadrées, le champ de recherche encadré ; les petites capitales espacées ; les grilles de cartes à icône et les rangées de chiffres-clés géants ; emojis et étincelles « IA » ; coins au-delà de 6 px, pilules, ombres lourdes, bordure colorée sur un seul côté.

**Key Characteristics:**
- Graphite chaud (`fond`) et texte blanc cassé, trois encres de texte et quatre filets ; aucune teinte de statut décorative, aucun vert.
- Un rouge vivant (`antenne`) réservé à l’appel en cours ; une brique mate (`alerte`) pour les erreurs, la révocation et les ruptures.
- Actions en texte précédées de leur touche : aucun bouton à fond plein ni à contour.
- Chivo pour le texte, Chivo Mono pour tout ce qui se lit caractère par caractère.
- Tableaux denses en filets d’un pixel, jamais en cartes.
- Plat : la profondeur vient du ton ; une seule ombre, sous le panneau flottant des raccourcis.
- Mouvement réservé à ce qui vit : l’onde et la réplique de Mina.

## Colors

Une palette de neutres chauds très peu chromatiques sur fond graphite, où deux teintes seulement portent un sens, et jamais le même.

### Primary
- **Blanc cassé d’encre** (`encre`) : texte principal (16,56:1 sur le fond), action forte, filtre actif et son soulignement, lien de navigation courant et son trait, filet bas d’un champ au focus, trait d’un rendez-vous sur la frise et dans le glyphe d’étape, anneau de focus (`focus` vaut `encre`). Il n’y a pas d’accent de marque : l’action est dans l’encre.

### Secondary
- **Rouge antenne** (`antenne`) : ce qui vit, et rien d’autre. Nom « Mina » devant ses répliques, barres de sa voix sur la piste de parole et l’onde, chrono en ligne, cellule d’état d’une ligne de tableau vivante, trait vivant de la frise, trait plein de la ligne « En appel » dans la barre, point du logo pendant un appel.

### Tertiary
- **Brique mate** (`alerte`) et **Voile brique** (`alerte-fond`) : texte d’erreur, filet bas d’un champ invalide, message d’alerte, action « Raccrocher » et confirmation de révocation, numéro révoqué ou invalide. En forme seulement (point creux, trait coupé), pour une ligne coupée ou un appel en échec, dont le libellé reste graphite. Chroma OKLCH 0,077 contre 0,188 pour l’antenne : elle ne se lit jamais comme un rouge vivant.

### Neutral
- **Graphite chaud** (`fond`) : page, barre du haut, bandeau d’appel collant. Jamais le quasi-noir.
- **Graphite posé** (`surface`) : zones posées un cran au-dessus (bande Journée, zone de texte, confirmation, panneau des raccourcis, message neutre).
- **Voile de ligne** (`survol`) : ligne de tableau survolée ou sélectionnée, squelettes de chargement. `grille` porte la même valeur pour les lignes d’heure de la frise.
- **Encre douce** (`encre-2`) : texte secondaire fort, action normale au repos, réplique du prospect, conséquences d’une confirmation.
- **Encre sourde** (`encre-3`) : plancher de tout texte utile (5,27:1 sur le fond, 4,81 sur `survol`) ; métadonnées, comptes, en-têtes de tableau, placeholders, action discrète, lien de navigation au repos, voix du prospect sur l’onde.
- **Trait** (`trait`) et **Trait éteint** (`trait-2`) : non textuels. Traits de la frise et du glyphe d’étape, ligne libre en pointillé, contour d’une touche forte, filtre inerte à compte nul (`trait`) ; point éteint du logo (`trait-2`).
- **Filet** (`filet`) : séparateur entre lignes, sous la barre, sous les titres de section.
- **Filet appuyé** (`filet-2`) : sous un en-tête de tableau, base de la frise, axe de la piste de parole, bord du panneau flottant, surlignage d’un terme trouvé.
- **Filet fort** (`filet-fort`) : filet bas des champs et de la recherche, contour d’une touche ordinaire, barre de défilement.
- **Soulignement** (`souligne`) : soulignement au survol des actions, liens et filtres, filet bas d’un champ survolé, sélection de texte.

### Named Rules
**La règle de l’antenne.** Le rouge antenne ne marque qu’une chose : ce qui vit maintenant. Ni erreur, ni bouton au repos, ni badge ne l’emprunte ; sans appel en cours, il est absent de l’écran. Le point du logo est le seul « voyant » : aucun autre point rouge « live » n’est ajouté.

**La règle de la brique muette.** Une rupture (ligne coupée, appel en échec) se dit par la forme en brique, point creux ou trait coupé, et son libellé reste en graphite. La brique en texte est réservée aux erreurs, à la révocation et au raccrochage.

**La règle du plancher.** Aucun texte utile sous `encre-3`. `trait` et `trait-2` ne portent jamais de texte, seulement des traits, des pointillés et des glyphes (seule exception : le filtre inerte à compte nul, désactivé).

## Typography

**Display Font:** Chivo (variable, avec `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Chivo
**Label/Mono Font:** Chivo Mono (variable, avec `ui-monospace, monospace`)

**Character:** une grotesque au dessin serré et un peu brut, qui garde une voix nette à 13 px comme à 34 px ; sa mono jumelle prend tout ce qui se compare caractère par caractère, sans changer de famille. Le sous-ensemble latin n’a ni ←, ni →, ni ↵ : les touches s’écrivent en toutes lettres (Entrée, Échap, Espace).

### Hierarchy
- **Sous-titre** (500, 2,125 rem, interligne 2,625 rem, approche −0,01 em, `text-balance`, 34 ch) : la phrase de Mina au centre de la bande d’appel. Variante longue à 1,75 rem sur 48 ch, 1,25 rem sur mobile, trois lignes au plus. Précédée de « Mina » en 17 px 600 antenne.
- **Headline** (600, 1,25 rem, interligne 1,75 rem, approche −0,01 em) : titre de page, avec son compte en mono 14 px `encre-3`.
- **Title** (600, 1,0625 rem, interligne 1,5 rem) : nom du prospect dans la bande d’appel ; en 400, réplique du prospect au-dessus du sous-titre.
- **Section** (600, 0,9375 rem) : titres de section posés sur un filet.
- **Lecture** (400, 0,9375 rem, interligne 1,5 rem) : répliques du fil d’appel (68 ch), zones de texte.
- **Body** (400, 0,875 rem, interligne 1,25 rem) : taille du corps de l’app, des tableaux, des actions, des filtres, de la navigation.
- **Label** (400, 0,8125 rem, interligne 1,125 rem) : libellés de champ (500), aides, sous-titres de page (60 ch), messages, état de la ligne, pastille d’autorisation. C’est la taille la plus employée.
- **Données** (Chivo Mono 400, 0,75 rem) : heures et durées dans les cellules, compteurs ; les en-têtes de tableau prennent la même taille en Chivo. En ligne dans un texte, la mono prend la taille de son voisin.
- **Touche** (Chivo Mono 400, 0,6875 rem sur 18 px) : touches de clavier, graduations horaires de la frise.

Graisses en usage : 400, 500, 600. Pas de 700, pas de capitales forcées, pas d’interlettrage positif. Le nom de qui parle est en casse normale, en 600.

### Named Rules
**La règle de la chasse fixe.** Heures, durées, chronos, numéros, comptes, versions et touches sont en Chivo Mono ; tout le reste est en Chivo. Aucune troisième police.

## Layout

Pleine largeur par défaut, dans une gouttière de 16 px, 32 px dès 640 px, 48 px dès 1280 px (`--gouttiere`). Les pages de lecture se limitent à 72 rem, alignées à gauche, jamais centrées. Aucune barre latérale.

- **Barre du haut :** 64 px, collante dès 640 px, fermée par un filet : marque (17 px de haut), navigation espacée de 24 px, puis à droite l’état de la ligne et « Raccourcis ». La ligne d’état dit aussi le plafond atteint (« Plafond atteint · prochain appel à 14:32 ») et, pendant un appel téléphone, le chrono depuis le décroché ; dès 1280 px, la campagne en cours ou suspendue s’y ajoute (« Campagne X · 34/100 », comptes en mono), en lien vers sa régie. Sous 640 px, deux rangées : marque et état (48 px), puis la navigation qui défile seule (40 px), barre non collante.
- **En-tête de page :** 32 px au-dessus, 20 px au-dessous (24 et 16 sur mobile) ; lien retour en `encre-3`, titre, sous-titre ; l’action alignée en bas à droite.
- **Tableaux :** grille de colonnes par tableau (`--colonnes`), 16 px entre colonnes, lignes de 38 px ; sous 640 px, chaque ligne passe sur deux rangées de 52 px au moins, les en-têtes deviennent réservés aux lecteurs d’écran et les cellules secondaires disparaissent. Toute la ligne est cliquable par son seul lien.
- **Filtres et recherche :** filtres en ligne espacés de 22 px, recherche de 300 px à droite, pleine largeur et au-dessus sur mobile.
- **Rythme :** 6 px entre libellé, champ et aide ; 8 à 16 px entre actions voisines ; 14 px entre les rangées de la bande d’appel ; zones posées bord à bord (`PleineLargeur`) quand elles doivent couper la page.
- **Tactile :** au pointeur grossier, actions, filtres et liens montent à 44 px et les touches disparaissent.

## Elevation & Depth

Le système est plat. La profondeur vient du ton (`fond`, `surface` un cran plus clair, `survol`) et des filets, jamais du flou. Les contours de contrôle sont des filets bas ou des ombres intérieures d’un pixel, qui s’épaississent sans décaler la mise en page.

### Shadow Vocabulary
- **Panneau flottant** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.35)`) : le panneau d’aide des raccourcis, seul calque qui flotte, bordé de `filet-2` sur `surface`.
- **Filet bas appuyé** (`box-shadow: inset 0 -1.5px 0 var(--encre)`) : le soulignement du filtre actif.
- **Épaississement au focus** (`box-shadow: inset 0 -0.5px 0 var(--encre)`, ou `var(--alerte)` en erreur) : ajouté au filet bas d’un champ pour le porter à 1,5 px.
- **Relief de touche** (`box-shadow: inset 0 0 0 1px var(--filet-fort), inset 0 -1px 0 var(--filet-fort)` ; `var(--trait)` pour une touche forte) : cadre et fond appuyé d’une touche.

### Named Rules
**La règle du plat.** Rien ne flotte hors du panneau des raccourcis : pas d’autre ombre portée, pas de flou, pas de verre. Un état se signale par un changement de ton, de trait ou de soulignement.

## Shapes

Des angles à peine adoucis, et de moins en moins à mesure que l’objet rapetisse : 6 px pour les blocs posés (messages, confirmation, zone de texte, panneau des raccourcis), 4 px pour la zone d’une action, d’un filtre ou d’un lien et pour l’anneau de focus, 3 px pour une touche et les barres de squelette, 2 px pour le surlignage d’un terme trouvé. Le cercle ne sert qu’au point creux d’échec (7 px, trait 1,5 px en brique). Les lignes de tableau n’ont aucun coin : des filets horizontaux d’un pixel, sans cadre. Les glyphes sont au trait : chevrons de 1,25 px à bouts ronds, traits d’état de 1,5 px, glyphe d’étape en barre verticale de 3 px dont la hauteur suit l’étape atteinte.

## Components

### Actions
Des mots, pas des boutons : un libellé précédé de sa touche, sans fond ni contour.
- **Shape :** zone de 36 px de haut (44 px au toucher), 6 px de marge horizontale compensée par un retrait négatif pour que le texte s’aligne sur la colonne, rayon 4 px, texte Body, 8 px entre touche et libellé.
- **Forte :** `encre` en 600, touche au contour `trait`. Une par contexte : soumettre, créer, confirmer, prendre la main.
- **Normale :** `encre-2` en 500, `encre` au survol. **Discrète :** `encre-3`, `encre-2` au survol (annuler, effacer). **Alerte :** brique en 500 (raccrocher, révoquer).
- **Hover / Focus :** le libellé se souligne d’un pixel en `souligne`, décalé de 4 px ; anneau de focus de 2 px en `focus`, décalé de 2 px. Désactivé à 45 %, sans soulignement. Pendant l’envoi, le libellé d’attente se superpose au libellé pour que la largeur ne bouge pas. Transitions de 150 ms sur la couleur.

### Touche
Petit cadre en Chivo Mono 11 px, 18 px de haut, 18 px de large au moins, rayon 3 px, fond appuyé d’un pixel. Ordinaire en `encre-3` sur `filet-fort` ; forte en `encre` sur `trait`. Les combinaisons posent une touche par partie (« Ctrl » « Entrée »). Décorative dans une action, masquée au toucher.

### Filtres
Texte en ligne, espacé de 22 px, avec son compte en mono `encre-3`. Inactif : `encre-3`, souligné en `souligne` au survol. Actif : `encre` en 600, souligné d’un filet intérieur de 1,5 px en encre. Un filtre à compte nul reste à sa place, inerte, en `trait`.

### Inputs / Fields
- **Style :** saisie et menu déroulant sur filet bas d’un pixel en `filet-fort`, sans fond, sans coins, sans marge intérieure horizontale, 36 px de haut, placeholder `encre-3`. Chevron de 10 × 6 px au trait de 1,25 px, en `encre-3`, à 4 px du bord. La zone de texte, seule, est posée sur `surface` avec 6 px de rayon, 80 px de haut au moins, hauteur qui suit le contenu ; Ctrl Entrée soumet.
- **Focus :** le filet passe en `encre` et s’épaissit à 1,5 px ; c’est l’indicateur, sans anneau en plus. Au survol, le filet passe en `souligne`.
- **Error / Disabled :** filet en brique à 1,5 px, message d’erreur en brique sous le champ ; désactivé à 45 %.
- **Champ :** libellé Label 500 en `encre` au-dessus, aide en `encre-3` dessous, 6 px entre chaque. Cases et radios natifs teintés en `encre`.
- **Recherche :** filet bas de 30 px, 300 px de large, « / » affiché en touche à droite tant que le champ est vide ; Échap vide puis rend le focus, ↓ descend aux résultats.

### Navigation
Liens texte en Body, `encre-3` au repos, `encre-2` au survol avec un filet d’un pixel en `souligne` 11 px sous la ligne médiane ; lien courant en `encre`, filet de 1,5 px en encre. La graisse ne change jamais : la navigation ne saute pas. Variante onglet en Label, 36 px, avec compte en mono, pour les sections d’une entreprise.

### Tableau dense
Rôles de tableau sur une grille. En-tête en Données `encre-3` sur un filet `filet-2` ; lignes de 38 px séparées par des filets `filet`, voile `survol` au survol ou à la sélection, anneau de focus rentré (décalé de −2 px) sur toute la ligne. Heures et durées en mono 12 px `encre-3`, alignées à droite pour les durées. Une ligne vivante passe sa cellule d’état en antenne ; une ligne atténuée passe en `encre-3`. Termes trouvés surlignés en `filet-2`. Les gestes d’une ligne (`S Sauter`, `Retirer` dans la file d’une campagne) sont des actions discrètes en bout de ligne ; leur confirmation s’ouvre sous la ligne.

### Blocs posés
- **Message :** 6 px de rayon, 10 × 14 px de marge, texte Label. Neutre : `surface` et `encre-2`, en `status`. Alerte : voile brique et brique, en `alert`.
- **Confirmation :** en ligne, juste sous l’action qui l’ouvre, sur `surface` (12 × 14 px, 6 px de rayon) : question en Body 500, conséquences en Label `encre-2` (68 ch), puis « Entrée » + action forte ou alerte et « Échap Annuler ». Le focus va au conteneur, jamais à un bouton. Obligatoire pour tout geste qui fait sonner, prend la main, révoque, desserre un garde-fou ou ne se défait pas (retirer un prospect de la file, terminer une campagne, archiver un script en usage, oublier le téléphone). Jamais pour un frein : Raccrocher, Suspendre et Sauter sont immédiats.
- **Conflit :** message d’alerte posé dans le formulaire refusé, qui dit qui a modifié et quand (« Fiche modifiée par Claude Code à 14:02 ») puis deux actions normales, « Recharger » et « Écraser » ; la saisie reste en place.
- **État vide :** pas de bloc ni d’illustration : un titre Body 500, une phrase en `encre-3` (56 ch), l’action suivante ; 40 px de marge et un filet dessous.
- **Squelette :** lignes de 38 px sur filet, barres `survol` de 12 px aux coins de 3 px, statiques, sans reflet.

### Pastille d’autorisation
Trait de 8 px à 1,5 px suivi du libellé Label. Autorisé : trait plein, `encre-2`. Sans consentement : trait interrompu (3 px, 2 px) en `trait`, libellé `encre-3`. Révoqué ou numéro invalide : trait interrompu et libellé en brique. Le cas normal ne crie pas.

### Ligne d’état (signature)
Toujours dans la barre, à droite : un trait de 56 × 16 px (16 px sur mobile) à 1,5 px, puis le libellé Label, dans un lien vers la page Téléphone. Libre ou relevé : pointillé (2 px, 4 px) en `trait`, libellé `encre-3`. En appel : trait plein et libellé en antenne. Coupée (déconnecté, injoignable) : trait coupé au milieu en brique, libellé `encre-2`. Inconnu : trait coupé en `trait`. Transition de 300 ms sur la couleur. `role="status"`.

### Bande d’appel (signature)
Trois rangées espacées de 14 px. En haut, l’identité (nom en Title 600, entreprise et numéro masqué en `encre-3`) à gauche, l’état, le chrono en mono 15 px (antenne en ligne), l’étape signalée par Mina (« Étape 2/4 · Qualification », Label `encre-3`, numéros en mono, tronquée ; absente pendant une prise de main) et les actions `E Écouter`, `Espace Prendre la main`, `Raccrocher` à droite. Au centre, la réplique du prospect en Title `encre-2` puis la phrase de Mina en sous-titre, sur 84 px au moins. En bas, la piste de parole de 40 px (32 px sur mobile) : une barre de 2 px par mot, Mina en antenne au-dessus d’un axe `filet-2`, le prospect en `encre-3` dessous ; seule la réplique en cours s’anime (`parole`, 0,8 s, alternée). Quand la ligne relaie les niveaux des deux voix et que l’écoute est fermée, l’onde remplace la piste à la même place : une barre de 2 px tous les 5 px par relevé de 50 ms, Mina en antenne au-dessus, le prospect dessous, qui défile de droite à gauche au rythme du temps ; en mouvement réduit, la piste reste. Hors de vue, un bandeau collant de 44 px sous la barre reprend nom, état, chrono, fin de phrase et actions.

### Frise de la journée (signature)
Bande posée sur `surface`, bord à bord, entre deux filets. Graduations horaires en Touche `encre-3`, lignes d’heure d’un pixel en `grille`, 48 px de haut sur un filet `filet-2`. Un trait par appel, de 2 px au moins (1 px sur mobile), dont la hauteur suit l’étape atteinte : `trait` par défaut, `encre` pour un rendez-vous, antenne sur 5 px pour l’appel en cours, point creux brique de 7 px pour un échec. Maintenant marqué d’un pointillé vertical en `trait`. Au survol d’une ligne du tableau, le trait correspondant prend un contour `encre-2` ; les appels filtrés hors vue tombent à 35 %.

### Marque
Mot-symbole « autocalled. » en `encre`, 17 px de haut. Le point final est le voyant d’antenne : `trait-2` au repos, antenne pendant un appel, transition de 300 ms.

## Do's and Don'ts

### Do:
- **Do** passer par les jetons de `globals.css` (`bg-surface`, `text-encre-3`, `border-filet`…), jamais par une couleur en dur.
- **Do** écrire chaque action comme un texte précédé de sa touche, avec un raccourci qui fait le même clic que la souris.
- **Do** mettre en Chivo Mono les heures, durées, chronos, numéros, comptes et versions.
- **Do** séparer les lignes par des filets d’un pixel en `filet`, sur 38 px de haut dans les tableaux.
- **Do** dire un état par la forme d’abord (trait plein, pointillé ou coupé, point creux), la couleur ensuite.
- **Do** garder tout texte utile à `encre-3` ou au-dessus ; `trait` et `trait-2` restent aux traits et aux glyphes.
- **Do** ouvrir une confirmation en ligne pour tout geste qui fait sonner un téléphone, prend la main, révoque, desserre un garde-fou ou ne se défait pas ; laisser les freins (raccrocher, suspendre, sauter) immédiats.
- **Do** réserver le mouvement à ce qui vit, et le couper sous `prefers-reduced-motion`.

### Don't:
- **Don't** poser de bouton à fond plein ni à contour, ni la paire des deux.
- **Don't** encadrer un filtre en puce ni un champ de recherche : texte souligné et filet bas.
- **Don't** employer l’antenne hors de ce qui vit, ni ajouter un point rouge « live » à côté de celui du logo.
- **Don't** utiliser la brique en texte hors des erreurs, de la révocation et du raccrochage.
- **Don't** ajouter de dégradé, de halo, de lueur colorée, de flou ou de verre dépoli.
- **Don't** arrondir au-delà de 6 px, ni faire de pilule.
- **Don't** poser d’ombre portée hors du panneau flottant des raccourcis.
- **Don't** introduire une troisième police, ni Inter, Geist, JetBrains Mono ou IBM Plex.
- **Don't** écrire d’étiquettes en petites capitales espacées ; le nom de qui parle est en casse normale, en 600.
- **Don't** présenter une liste en cartes, ni mettre une rangée de chiffres-clés géants en haut de page : les comptes vivent dans les filtres et les lignes.
- **Don't** poser de bordure colorée sur un seul côté d’un bloc.
