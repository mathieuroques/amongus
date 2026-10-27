# Rapport de tests

*Exécutés le 27/10/2026 dans l’environnement de développement (Linux, Node 22, wrangler 4.153 / workerd local, Chromium Playwright). Commandes : `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:browser`.*

## Résultats

| Suite | Contenu | Résultat |
|---|---|---|
| Vérification des types | client + serveur (TypeScript strict) | ✅ aucune erreur |
| Tests unitaires du moteur (`test/engine.test.ts`) | règles, transitions, vues filtrées | ✅ **50/50** |
| Tests d’intégration (`test/integration/game.test.ts`) | vrai serveur local (Worker + Durable Object SQLite) + **41 WebSockets** (MJ + 40 joueurs) | ✅ **15/15** (~45 s) |
| Tests navigateur (`test/browser/ui.test.ts`) | Chromium, 5 téléphones (iPhone 13) + MJ sur ordinateur, parcours complet par l’interface | ✅ **7/7** (~37 s) |

## Correspondance avec les 27 scénarios demandés

| # | Scénario | Où c’est testé |
|---|---|---|
| 1 | Création d’une partie et de son code | intégration 1 ; navigateur 1 |
| 2 | Connexion de plusieurs téléphones | intégration 2-3 (40 joueurs) ; navigateur 1 (5 navigateurs) |
| 3 | Pseudonymes distincts | unitaire « pseudonymes en double » ; intégration 2-3 (`name_taken`) |
| 4 | Rôles cachés sans fuite | unitaires « confidentialité » ; intégration 4-5 (vue de chacun des 40 joueurs inspectée) |
| 5 | Démarrage | intégration 4-5 ; navigateur 2 |
| 6 | Tâches différentes selon les joueurs | unitaire ; intégration 6-9 |
| 7 | Validation d’une tâche autorisée | unitaire ; intégration 6-9 ; navigateur 3 (mini-jeu joué dans l’interface) |
| 8 | Refus d’une tâche terminée ou non attribuée | unitaire ; intégration 6-9 |
| 9 | Progression cohérente | intégration 6-9 (barre reçue par les autres téléphones), 26-bis |
| 10 | Sabotage autorisé | unitaires « sabotages » ; intégration 10-11 |
| 11 | Sabotage refusé | unitaires (délai, doublon, équipier) ; intégration 10-11 et 24 |
| 12 | Délai d’élimination | unitaire ; intégration 12-13 |
| 13 | Refus d’éliminer un mort | unitaire ; intégration 12-13 |
| 14 | Signalement d’un corps | unitaire ; intégration 14-18 ; navigateur 4 |
| 15 | Actions interrompues en réunion | unitaire ; intégration 14-18 |
| 16 | Ouverture / clôture du vote | unitaires ; intégration 14-18 ; navigateur 4 |
| 17 | Refus des votes doubles | unitaire ; intégration 14-18 |
| 18 | Abstentions et égalités | unitaires « égalité… », « égalité avec passer », « votes anonymes » |
| 19 | Règles des morts | unitaires « fantômes » ; intégration 19 |
| 20 | Conditions de victoire | unitaires (tâches, éjection, parité par élimination, parité par éjection, départ, sabotage critique) ; intégration 20 ; navigateur 4 |
| 21 | Reconnexion après actualisation | intégration 21-22 ; navigateur 5 (`page.reload()`) |
| 22 | Reconnexion après perte réseau | intégration 21-22 (coupure brutale puis retour) |
| 23 | Accès aux secrets sans autorisation | intégration 23 (connexion anonyme, faux jeton, mauvais code MJ) |
| 24 | Modification frauduleuse depuis le navigateur | intégration 24 (réponse trop rapide, défi d’un autre joueur, actions d’imposteur par un équipier) ; unitaires (codes inventés → blocage) |
| 25 | Permissions d’administration | intégration 25 (un joueur envoie des commandes MJ : toutes refusées) |
| 26 | Nombre maximal de joueurs (40) | unitaire « 40 joueurs » ; intégration complète à 40 (+ refus du 41ᵉ) |
| 27 | Fin de partie et nouvelle partie | unitaire ; intégration 20/27 ; navigateur 4-5 |

Tests supplémentaires : validations concurrentes de la même tâche (une seule comptée), fin automatique d’un sabotage par l’**alarme** du serveur sans aucune action, persistance de l’état après **redémarrage du serveur**, pause et arrêt d’urgence (minuteurs décalés), corps qui disparaît, imposteur au comportement d’écran identique pendant panne/communications, absence de défilement horizontal sur écran 360×640, génération du PDF des supports.

## Captures d’écran
Produites automatiquement par le test navigateur dans `docs/captures/` (accueil, salon, révélation du rôle, tâches, poste scanné, mini-jeu, rôle imposteur, code d’élimination, corps, urgence, réunion, vote, résultat, fin de partie, pause, arrêt d’urgence, tableau de bord MJ).

## Ce qui n’a PAS pu être testé
- **Déploiement réel sur Cloudflare** : impossible sans compte (voir README). Les tests tournent sur `wrangler dev`, qui exécute le même moteur (workerd) et les mêmes Durable Objects SQLite que la production, mais pas sur le réseau Cloudflare.
- **Vrais téléphones** (Safari iOS, Chrome Android) : testés seulement par émulation Chromium (taille d’écran, tactile). La lecture de QR code par la caméra n’a pas pu être testée (pas de caméra) ; la saisie manuelle du code, qui est la solution de secours, est testée.
- **Vibration et sons** : non vérifiables automatiquement (et la vibration n’existe pas sur iOS).
- **Installation PWA** (ajout à l’écran d’accueil) : manifeste et service worker fournis ; le service worker n’est actif qu’en HTTPS, donc non exercé en local.
- **Charge réseau réelle** (Wi-Fi d’une maison avec 40 téléphones) : simulée par 40 connexions locales seulement.
- **Session de jeu réelle** avec des humains : à faire lors d’une première partie test.

## Limites connues
- La présence physique à un poste ou à côté d’une victime n’est pas prouvée techniquement (règle d’honneur, journal et arbitrage du MJ).
- Un téléphone en veille perd sa connexion : il se reconnecte en quelques secondes au réveil, mais ne sonne pas pendant la veille. L’option « Garder l’écran allumé » existe (Android/Chrome récents).
- Les quotas gratuits Cloudflare se remettent à zéro chaque jour à 0 h UTC (2 h du matin en été en France) ; une partie de 40 joueurs n’en consomme que quelques pourcents.
