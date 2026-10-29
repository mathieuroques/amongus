# Tâches et supports imprimables

## Catalogue des tâches générées automatiquement
Le MJ peut les renommer, les désactiver, en créer d’autres et choisir pour chaque étape le poste et le mini-jeu.

| Tâche | Type | Étapes (mini-jeux) |
|---|---|---|
| Badge d’accès | commune | glisser un badge |
| Réparer les câbles | commune | relier les fils de couleur |
| Transfert de données | longue | transfert (rester 8 s au poste) → transfert dans une autre pièce |
| Réaligner les moteurs | longue | alignement → alignement dans une autre pièce |
| Démarrer le réacteur | longue | séquence → calibrage |
| Énigme du coffre | longue | inventaire papier → puzzle papier |
| Séquence de démarrage | courte | mémoriser et reproduire 5 cases |
| Déverrouillage | courte | toucher 1 à 10 dans l’ordre |
| Calibrage | courte | arrêter un curseur 3 fois dans la zone verte |
| Nettoyage des filtres | courte | toucher 8 cibles |
| Scan médical | courte, **visuelle** | rester 10 s sur la marque au sol (grand écran vert visible de loin) |
| Inventaire | courte, papier | compter un symbole sur la grille imprimée de la fiche ; **la question change à chaque fois** (6 symboles × toute la grille ou une moitié = 30 questions) |
| Puzzle | courte, papier | ranger des bandes découpées (1 point, 2 points…) et lire le mot du **haut** ou du **bas** (tiré au hasard : deux mots par jeu de bandes) |
| Câblage secondaire | courte | relier les fils |
| Alignement de l’antenne | courte | aligner un curseur |

Chaque mini-jeu impose une durée minimale (2 à 10 s) avant validation, et le serveur vérifie la réponse (les réponses des énigmes papier ne sont jamais envoyées aux téléphones : seule la question part). Retenir une réponse d’une partie à l’autre ne sert donc à rien : il faut la fiche sous les yeux.

S’il n’y a qu’une tâche du joueur à un poste, le mini-jeu s’ouvre dès la lecture du QR code. Les tâches simulées des imposteurs avancent exactement comme celles de l’équipage (mêmes messages, même liste), sans compter dans la barre.

## Mini-jeux de réparation
| Sabotage | Poste | Mini-jeu |
|---|---|---|
| Panne de courant | Énergie (fictif) | basculer 5 interrupteurs sur MARCHE |
| Communications | Radio | superposer deux ondes |
| Oxygène | Oxygène A et B | recopier un code à 5 chiffres |
| Réacteur | Réacteur A et B | maintenir un bouton, à deux, en même temps |

## Kit de fiches universel
Imprimé une fois pour toutes ([PDF](pdf/kit-fiches.pdf), ou accueil → « Imprimer le kit de fiches ») : 40 postes, 8 fiches spéciales, étiquettes, panneaux, badges et aide-mémoire génériques. Le catalogue du kit compte **36 tâches (40 étapes)**, figées : les 15 tâches ci-dessus et 21 tâches courtes de plus, pour que chacune des 40 fiches ait une tâche quand toutes sont posées. Les énigmes papier sont imprimées sur les postes 01 (« Inventaire »), 02 (« Puzzle »), 03 et 04 (« Énigme du coffre ») et le scan médical se fait devant le poste 05 ; les autres étapes sont réparties automatiquement sur les fiches appairées, à chaque changement.

## Supports générés par l’application (bouton « Imprimer » du MJ)
- **Affiche d’invitation** : QR code du lien d’invitation + code de partie (valable pour toutes les « nouvelles parties » de la même session).
- **Fiches de postes de tâches** : nom, pièce, QR code, code court, liste des tâches réalisables, énigmes papier (grille de symboles repérée A–F / 1–8, moitiés marquées d’un trait épais ; bandes à découper portant une lettre en haut et une lettre blanche sur fond noir en bas).
- **Fiches spéciales** : bouton d’urgence, réacteur A/B, oxygène A/B, énergie (fictif), radio, moniteur de vie — avec la consigne de réparation.
- **Étiquettes de pièces**, panneaux **ZONE INTERDITE** et **zone de passage**.
- **Badges fantômes** (12 par page).
- **Aide-mémoire** des règles, avec les durées réglées pour la partie.

Un exemple complet généré avec la maison d’exemple est fourni : `docs/pdf/exemple-supports-imprimables.pdf` (les codes y sont propres à cet exemple : imprimez vos propres fiches depuis votre tableau de bord).

## Solution de secours sans imprimante
Recopiez à la main, en gros, sur une feuille par poste : le **nom du poste** et son **code** (onglet Terrain). Les joueurs taperont le code au lieu de scanner. Pour les énigmes papier, désactivez les tâches « Inventaire », « Puzzle » et « Énigme du coffre » (ou recopiez la grille).
