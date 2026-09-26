---
name: Autocalled
description: Régie de Mina, l’assistante vocale de prospection ; interface opérateur.
colors:
  fond: "#f6f5f2"
  surface: "#fdfdfc"
  encre: "#1d1c1a"
  encre-2: "#55524c"
  encre-3: "#6f6b64"
  filet: "#e3e1dc"
  filet-fort: "#cbc8c1"
  survol: "#eeede9"
  antenne: "#d23f26"
  alerte: "#a1321f"
  alerte-fond: "#fbeeeb"
  focus: "#1d1c1a"
typography:
  headline:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    fontFeature: "\"ss01\", \"tnum\" 0"
  label:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  meta:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  donnees:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
rounded:
  anneau: "4px"
  md: "6px"
  full: "9999px"
spacing:
  champ: "6px"
  controle-x: "14px"
  ligne: "16px"
  ligne-aeree: "20px"
  formulaire: "24px"
  section: "48px"
  controle: "36px"
  barre: "56px"
components:
  button-principal:
    backgroundColor: "{colors.encre}"
    textColor: "{colors.fond}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondaire:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.encre}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondaire-hover:
    backgroundColor: "{colors.survol}"
  button-discret:
    textColor: "{colors.encre-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-discret-hover:
    backgroundColor: "{colors.survol}"
    textColor: "{colors.encre}"
  saisie:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.encre}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  lien-nav:
    textColor: "{colors.encre-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  lien-nav-actif:
    textColor: "{colors.encre}"
  message-neutre:
    backgroundColor: "{colors.survol}"
    textColor: "{colors.encre-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  message-alerte:
    backgroundColor: "{colors.alerte-fond}"
    textColor: "{colors.alerte}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
---

# Design System: Autocalled

## Overview

**Creative North Star: "La régie qui se tait"**

L’interface opérateur d’Autocalled est une régie d’écoute : un poste de préparation calme, où l’écran reste silencieux tant qu’aucun appel ne vit. Tout y est quasi monochrome, en neutres chauds sans crème ; le graphite porte à la fois l’encre et les actions. La hiérarchie vient de la graisse, de la taille et du vide, pas de la couleur. Une seule chose aura le droit de s’allumer : l’appel en cours, en rouge « antenne ». Tant que la ligne n’est pas branchée, ce rouge n’apparaît nulle part.

La densité est celle d’une liste en tableau aérée, pas d’un tableau de bord : une barre fine en haut (marque, navigation, état de la ligne en trait), un en-tête de page, puis des lignes séparées par des filets d’un pixel. Le soin tient aux détails de précision : filets fins, contours de champ dessinés en ombre intérieure, deux grammaires de focus, soulignement discret au survol, chasse fixe pour tout ce qui est un numéro, une heure ou un identifiant.

Rejets confirmés par la direction imposée (`docs/direction-visuelle.md`) : le tableau de bord SaaS (barre latérale grise, grilles de cartes à icône, rangées de chiffres géants), les dégradés violet-bleu, halos néon et verre dépoli, les emojis et étincelles « IA », les coins très arrondis et ombres lourdes, les libellés creux.

**Key Characteristics:**
- Neutres chauds, graphite pour l’encre et l’action ; aucun vert, aucune teinte de statut décorative.
- Deux rouges aux rôles disjoints : « antenne » pour le vivant (réservé), « alerte » pour les erreurs et la révocation.
- Listes en filets d’un pixel, jamais en cartes.
- Une police de texte (Schibsted Grotesk) et une chasse fixe (Geist Mono) pour les données.
- Plat par défaut ; une seule ombre légère, sous l’action principale.
- Mode sombre complet, porté par les jetons via `prefers-color-scheme`.

## Colors

Une palette quasi monochrome de neutres chauds à teinte jaune-gris (teinte OKLCH ≈ 85-95, chroma sous 0,012), où deux rouges seulement portent un sens.

### Primary
- **Graphite d’encre** (`encre`) : le texte courant, les titres, le fond du bouton principal, le point plein de l’état « autorisé », l’anneau de focus (`focus` vaut `encre` dans les deux modes) et la sélection de texte inversée. C’est aussi la couleur de l’action : il n’y a pas d’accent de marque.

### Secondary
- **Rouge antenne** (`antenne`) : réservé à l’appel en cours. Son seul emploi dans le build est l’état `en-appel` de l’élément signature (trait, point et libellé de la ligne). La barre du haut affiche aujourd’hui `non-branchee` en dur : ce rouge n’est visible sur aucun écran livré, et c’est voulu.

### Tertiary
- **Rouge brique d’alerte** (`alerte`) et **Voile d’alerte** (`alerte-fond`) : texte d’erreur des champs, contour de champ invalide, bloc `Message` d’alerte, bloc de confirmation de révocation, et l’avertissement « aucun texte de consentement ». Plus sombre et moins saturé que l’antenne, pour qu’une erreur ne se confonde jamais avec le vivant.

### Neutral
- **Papier chaud** (`fond`) : fond de page et de la barre du haut ; aussi la couleur de texte du bouton principal.
- **Surface claire** (`surface`) : fond des champs et du bouton secondaire, un cran plus clair que le papier.
- **Graphite doux** (`encre-2`) : sous-titres, texte secondaire des lignes, liens de navigation au repos, texte du bouton discret, message neutre.
- **Gris taupe** (`encre-3`) : métadonnées, aides de champ, compteurs, placeholders, numéros d’étape, état « non autorisé » (point creux et libellé), libellé de la ligne au repos.
- **Filet** (`filet`) : toutes les lignes de séparation de liste, sous la barre du haut, sous les titres de section.
- **Filet fort** (`filet-fort`) : contour intérieur des champs et du bouton secondaire, soulignement au survol des lignes, trait de la ligne au repos.
- **Voile de survol** (`survol`) : fond au survol des boutons discrets et secondaires, des liens de navigation, de la version courante d’un script ; fond du message neutre.

### Mode sombre
Le mode sombre remplace les valeurs des mêmes douze jetons sous `@media (prefers-color-scheme: dark)`, sans classe à basculer ni nom de jeton propre au sombre : `fond` #131312, `surface` #1a1a18, `encre` #ebe9e4, `encre-2` #aeaaa2, `encre-3` #918d85, `filet` #2b2a27, `filet-fort` #3d3b37, `survol` #22211f, `antenne` #ff6a4d, `alerte` #ff8a73, `alerte-fond` #2a1714, `focus` #ebe9e4. Tout composant qui passe par les jetons est juste dans les deux modes ; une couleur en dur ne l’est pas.

### Named Rules
**La règle de l’antenne.** Le rouge antenne ne marque qu’une chose : un appel en cours. Ni bouton, ni lien, ni badge, ni erreur ne l’emprunte ; tant que rien ne vit, il est absent de l’écran.

**La règle de l’alerte confinée.** Le rouge d’alerte n’apparaît que dans les erreurs et la confirmation de révocation. Une action destructive au repos reste en bouton discret graphite ; le rouge vient avec la confirmation, pas avant.

**La règle sans vert.** Aucun vert, nulle part. « Autorisé » est un point plein en encre, « non autorisé » un point creux cerclé de gris taupe ; la forme porte l’état, pas la teinte.

## Typography

**Display Font:** aucune ; le titre de page est le plus grand niveau.
**Body Font:** Schibsted Grotesk (avec `ui-sans-serif, system-ui, sans-serif`)
**Label/Mono Font:** Geist Mono (avec `ui-monospace, monospace`)

**Character:** une grotesque de presse, droite et un peu serrée, qui donne une voix précise sans ornement ; la mono Geist prend en charge tout ce qui se lit chiffre par chiffre. Le corps active l’alternative `ss01` et coupe les chiffres tabulaires (`"tnum" 0`), puisque les chiffres qui doivent s’aligner passent en mono.

### Hierarchy
- **Headline** (600, 1,5 rem, interligne 2 rem, approche −0,02 em, `text-balance`) : titre de page (`EnTetePage`) et nom de l’entreprise dans son en-tête.
- **Title** (600, 0,9375 rem, interligne 1,5 rem) : titres de section (`TitreSection`), posés sur un filet. Variante plus grande (600, 1,125 rem) pour le nom d’un prospect sur sa fiche.
- **Body** (400, 0,9375 rem, interligne 1,5 rem) : texte courant et valeurs des champs. Les paragraphes explicatifs tiennent entre 56 et 70 ch (60 ch sous un titre de page, 62 ch en tête de section, 68 ch pour le contexte d’un prospect).
- **Label** (500, 0,8125 rem, interligne 1,25 rem) : libellés de champ, boutons, liens de navigation. En graisse 400, la même taille sert aux textes secondaires des lignes, aides et métadonnées.
- **Meta** (400, 0,75 rem, interligne 1 rem) : libellé d’état de la ligne, dates courtes des versions.
- **Données** (Geist Mono 400, 0,8125 rem par défaut) : numéros de téléphone, numéros de version (`v3`), rangs d’étape, horodatages, noms de fichiers et identifiants. Le numéro d’un prospect sur sa fiche monte à 1,125 rem, approche −0,01 em.

Graisses en usage : 400, 500, 600. Pas de 700, pas de capitales forcées, pas d’interlettrage positif.

### Named Rules
**La règle de la chasse fixe.** Tout ce qui se compare caractère par caractère (numéro, heure, horodatage, identifiant, numéro de version, rang) est en Geist Mono ; tout le reste est en Schibsted Grotesk. Aucune troisième police.

## Layout

Une colonne centrée de 72 rem au plus, marges latérales de 20 px, puis 32 px à partir de 640 px. La barre du haut fait 56 px, alignée sur la même colonne, fermée par un filet. Aucune barre latérale.

- **En-tête de page :** 48 px au-dessus, 32 px au-dessous ; titre et sous-titre à gauche, action principale alignée en bas à droite, qui passe à la ligne sur mobile. Sur les pages d’une entreprise, le fil « Entreprises » en gris taupe surmonte le titre, puis une navigation d’onglets en liens texte posée sur un filet.
- **Colonnes :** à partir de 1024 px, les écrans de détail passent en deux colonnes, contenu fluide à gauche et colonne étroite fixe à droite (entre 14 et 22 rem selon l’écran) pour l’import, les versions ou l’identité du numéro. Sous 1024 px, la colonne de droite passe dessous, ou dessus quand elle porte l’identité (fiche prospect). Les pages de réglage sans colonne latérale se limitent à une largeur de 44 à 52 rem.
- **Rythme :** 6 px entre libellé, champ et aide ; 24 px entre champs d’un formulaire ; 48 à 56 px entre sections ; 16 px de hauteur de ligne de liste, 20 px pour la liste des entreprises. Contrôles à 36 px de haut.
- **Tableaux :** la liste des prospects est un vrai tableau à en-têtes masqués (lecteurs d’écran seulement) ; la colonne du numéro disparaît sous 640 px, l’autorisation reste.

## Elevation & Depth

Le système est plat. La profondeur vient du ton (papier, surface un cran plus claire, voile de survol) et des filets, jamais de calques qui flottent. Aucun flou d’arrière-plan. Les contours des contrôles sont dessinés en ombre intérieure d’un pixel plutôt qu’en bordure, pour pouvoir s’épaissir au focus sans décaler la mise en page.

### Shadow Vocabulary
- **Appui de l’action** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.12)`) : sous le bouton principal, et nulle part ailleurs.
- **Contour dessiné** (`box-shadow: inset 0 0 0 1px var(--filet-fort)`) : champs, bouton secondaire, zone d’import. Au survol d’un champ, le contour passe en `encre-3` ; au focus, `inset 0 0 0 1.5px var(--encre)` ; en erreur (`aria-invalid`), `inset 0 0 0 1.5px var(--alerte)`.

### Named Rules
**La règle du plat.** Rien ne flotte : pas d’ombre portée hors de l’appui de l’action principale, pas de flou, pas de panneau superposé. Un état se signale par un changement de ton ou de trait.

## Shapes

Des angles à peine adoucis : 6 px sur tout ce qui est un contrôle ou un bloc teinté (boutons, champs, liens de navigation, messages, confirmation de révocation), cercle plein seulement pour les points d’état. L’anneau de focus prend 4 px de rayon. Les lignes de liste n’ont pas de coin du tout : ce sont des filets horizontaux d’un pixel, sans cadre. Les glyphes dessinés sont au trait fin : chevron du menu déroulant en 10 × 6 px, trait de 1 px à bouts ronds ; trait de la ligne à 1,5 px.

## Components

### Buttons
Sobres et précis : des pastilles de texte de 36 px, jamais d’icône décorative.
- **Shape :** angles adoucis (6 px), hauteur 36 px, 14 px de marge horizontale, texte Label 500, espacement interne de 8 px si un glyphe accompagne le texte.
- **Principal :** fond graphite d’encre, texte papier, appui de l’action ; au survol, le fond s’éclaircit à 88 % d’opacité. Un seul par formulaire, pour sa soumission : créer, importer, enregistrer la fiche, créer la version suivante, confirmer une révocation.
- **Secondaire :** fond surface, contour dessiné en filet fort, texte encre ; au survol, voile de survol. Pour les actions d’appoint (ajouter une étape, enregistrer une objection déjà existante, ouvrir le formulaire d’ajout) et pour les actions présentes mais indisponibles (« Appeler », désactivé tant que la ligne n’est pas branchée, avec son explication en texte gris taupe dessous).
- **Discret :** sans fond, texte graphite doux ; au survol, voile de survol et texte encre. Archiver, réactiver, annuler, réordonner, et le déclencheur « Révoquer ce numéro » avant confirmation.
- **Focus / Disabled :** anneau d’encre de 2 px décalé de 2 px ; désactivé à 45 % d’opacité avec curseur interdit. Transitions de 150 ms sur le fond, la couleur et l’ombre.

### Inputs / Fields
- **Style :** fond surface, contour dessiné en filet fort, angles de 6 px, 36 px de haut (zone de texte : 80 px minimum, hauteur qui suit le contenu, redimensionnable verticalement), placeholder gris taupe.
- **Focus :** le contour s’épaissit à 1,5 px en encre ; pas d’anneau extérieur, pas de halo.
- **Error / Disabled :** contour 1,5 px en alerte et message d’erreur en rouge brique sous le champ, à la place de l’aide ; menu déroulant désactivé à 40 %.
- **Champ :** libellé Label 500 au-dessus, aide en gris taupe au-dessous, 6 px entre chaque.
- **Menu déroulant :** apparence native retirée, chevron de trait d’un pixel à 12 px du bord droit, en gris taupe.

### Navigation
Liens texte, pas d’onglets dessinés. Label en graphite doux au repos ; au survol, voile de survol et texte encre ; page courante en encre et graisse 500, sans soulignement ni pastille. Même grammaire dans la barre du haut et dans les sections d’une entreprise (défilement horizontal sur mobile), et pour la liste des versions d’un script, où la version affichée garde en plus le voile de survol.

### Listes
Les collections (entreprises, prospects, objections, scripts, étapes) sont des lignes pleine largeur séparées par des filets d’un pixel, ouvertes par un filet en tête ou par le titre de section. Le nom en Body 500, le détail en dessous en Label 400 graphite doux, le résumé à droite en gris taupe. Au survol d’une ligne, le nom se souligne en filet fort avec 4 px de décalage ; la ligne ne change ni de fond ni de couleur. Les objections se déplient sur place (`details`), sans marqueur de disclosure natif.

### Blocs teintés
- **Message :** 6 px d’angles, 10 × 14 px de marge, texte Label. Neutre : voile de survol et graphite doux, en `status`. Alerte : voile d’alerte et rouge brique, en `alert`.
- **Confirmation de révocation :** bloc en voile d’alerte, phrase de conséquence en rouge brique, puis le bouton principal graphite « Révoquer » et un bouton discret « Annuler ».
- **État vide :** pas de bloc ni d’illustration ; une ligne de liste aérée (48 px de marge verticale, filet dessous) avec un titre en Body 500 et une phrase qui dit quoi faire, 56 ch au plus.

### Pastille d’autorisation
Point de 8 px suivi du libellé en Label 400. Autorisé : point plein en encre, libellé en encre. Non autorisé (révoqué, sans consentement, numéro invalide) : point creux cerclé d’un pixel gris taupe, libellé gris taupe.

### Ligne d’état (élément signature)
Toujours visible dans la barre du haut, à droite. Un trait horizontal de 56 × 16 px, épaisseur 1,5 px à bouts ronds, suivi du libellé Meta. Ligne non branchée : trait pointillé (2 px plein, 4 px vide) en filet fort, libellé gris taupe. Ligne libre : trait plein en filet fort. En appel : trait, point et libellé en rouge antenne ; c’est ici que la forme d’onde s’animera. Sous 640 px, le trait devient un point de 6 px. L’élément porte `role="status"`.

## Do's and Don'ts

### Do:
- **Do** passer par les douze jetons de couleur, jamais par une valeur en dur, pour que le mode sombre suive sans travail.
- **Do** séparer les éléments d’une liste par des filets d’un pixel en `filet`, sur toute la largeur de la colonne.
- **Do** mettre en Geist Mono les numéros, heures, horodatages, numéros de version, rangs et identifiants.
- **Do** dessiner les contours de contrôle en ombre intérieure (1 px en `filet-fort`, 1,5 px en `encre` au focus, 1,5 px en `alerte` en erreur).
- **Do** signaler un état par la forme (point plein ou creux, trait plein ou pointillé) avant la couleur.
- **Do** laisser une action indisponible visible et désactivée, avec une phrase qui dit pourquoi.

### Don't:
- **Don't** présenter une liste en cartes, en grille de cartes ou en cartes à icône.
- **Don't** utiliser de vert, ni aucune couleur de statut hors des deux rouges.
- **Don't** employer le rouge antenne pour autre chose qu’un appel en cours, ni le rouge d’alerte hors des erreurs et de la confirmation de révocation.
- **Don't** ajouter de flou d’arrière-plan, de verre dépoli, de dégradé ou de halo.
- **Don't** arrondir au-delà de 6 px, sauf les points d’état en cercle.
- **Don't** poser d’ombre portée ailleurs que sous le bouton principal.
- **Don't** introduire une troisième police, ni Inter par défaut.
- **Don't** mettre de rangée de chiffres-clés géants en haut de page : les comptes vivent en texte gris taupe dans les lignes.
- **Don't** poser de bordure colorée sur un seul côté d’un bloc ; les filets de liste restent neutres.
