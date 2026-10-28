# Rapport de tests

*Exécutés le 28/10/2026 (Linux, Node 22, wrangler 4.153 / workerd local, Chromium Playwright). Commandes : `npm run typecheck`, `npm test`, `npx vitest run --coverage`, `npm run test:integration`, `npm run test:browser`, `SIM_GAMES=300 npx vitest run test/simulation.test.ts`.*

## Résultats

| Suite | Contenu | Résultat |
|---|---|---|
| Vérification des types | client + serveur (TypeScript strict) | ✅ aucune erreur |
| Moteur de règles (`test/engine.test.ts`) | règles, transitions, vues filtrées, corrections du MJ | ✅ **51/51** |
| Modules (`test/modules.test.ts`) | les 11 mini-jeux et 3 réparations (bonne réponse acceptée, mauvaises refusées, réponses papier jamais envoyées), énigmes imprimées, codes et aléatoire, paramètres hors bornes, terrain (génération 1 à 25 pièces, 500 terrains malformés), notifications (contenu public uniquement), outils de test du MJ, abonnements push | ✅ **35/35** |
| Notifications push (`test/webpush.test.ts`) | chiffrement identique **au vecteur officiel de la RFC 8291**, jeton VAPID vérifié, refus des hôtes inconnus, aller-retour complet (déchiffrement côté téléphone) | ✅ **4/4** |
| Simulation aléatoire (`test/simulation.test.ts`) | parties complètes jouées par des agents (actions sensées, erreurs, tentatives de triche, pauses, corrections du MJ), invariants vérifiés après **chaque** action, vues de chaque joueur inspectées | ✅ 40 séries par défaut ; **300 séries : 1 010 parties terminées, 91 548 actions invalides refusées, 0 erreur inattendue** (149 victoires par les tâches, 531 par éjection, 26 par parité, 304 par sabotage critique) |
| Couverture du moteur partagé (`src/shared`) | lignes exécutées par les tests ci-dessus | **96,5 % des lignes, 88,8 % des branches, 98 % des fonctions** |
| Intégration (`test/integration/game.test.ts`) | vrai serveur local (Worker + Durable Object SQLite) + **41 WebSockets** (MJ + 40 joueurs) | ✅ **17/17** (~56 s) |
| Navigateur (`test/browser/ui.test.ts`) | Chromium : MJ sur ordinateur et téléphone, 5 téléphones (iPhone 13), parcours complet par l’interface | ✅ **11/11** (~125 s) |

### Ce que vérifie le test navigateur
- Accueil, création de partie, arrivée par le lien d’invitation (pseudonyme seul).
- Salon : test du son, entraînement local à un mini-jeu.
- **Onglet Tests du MJ : les 19 étapes de tâches du terrain d’exemple et les 3 réparations (22 vérifications) sont jouées par l’interface et validées par le serveur — les 11 mini-jeux et les 3 réparations sont donc tous exercés de bout en bout.**
- Préréglage et paramètres, « Faire sonner tous les téléphones » reçu par les 5 téléphones (écran d’alerte).
- Démarrage, révélation du rôle, vraie tâche par saisie du code d’un poste (et vérification que le téléphone ne reçoit pas la réponse).
- Élimination par code, corps, signalement, écran d’alerte « RÉUNION ! », rassemblement, vote avec barre de confirmation, annonce du rôle de l’éjecté, écrans « Vous avez gagné / perdu », écran de fin du MJ.
- Nouvelle partie, rechargement de page (rôle conservé), pause, arrêt d’urgence, reprise avec confirmation, cartes joueurs du MJ.
- Absence de défilement horizontal sur 360×640 (accueil, règles, tableau de bord du MJ sur téléphone), génération du PDF des supports.
- **Aucune erreur JavaScript** sur l’ensemble des pages pendant tout le test.

## Bugs trouvés et corrigés grâce à ces tests
- Mini-jeux (interrupteurs, ordre, cibles, câbles, séquence, calibrage) : des appuis très rapides pouvaient être perdus (valeur d’état périmée). Corrigé : chaque appui lit l’état courant et la validation ne part qu’une fois.
- Test de vote mal écrit (égalité réelle prise pour un bug) et invariants de simulation trop stricts (un fantôme d’équipage a le droit de faire une tâche) : corrigés côté tests, le moteur était juste.
- Serveurs de test restés actifs entre deux exécutions (faux échecs) : l’arrêt tue désormais tout le groupe de processus et vérifie que le port est libre.

## Correspondance avec les 27 scénarios demandés

| # | Scénario | Où c’est testé |
|---|---|---|
| 1 | Création d’une partie et de son code | intégration 1 ; navigateur 1 |
| 2 | Connexion de plusieurs téléphones | intégration 2-3 (40) ; navigateur 1 (5 navigateurs) |
| 3 | Pseudonymes distincts | unitaire ; intégration 2-3 |
| 4 | Rôles cachés sans fuite | unitaires ; intégration 4-5 (40 vues inspectées) ; simulation (vues à chaque étape) |
| 5 | Démarrage | intégration 4-5 ; navigateur |
| 6 | Tâches différentes selon les joueurs | unitaire ; intégration 6-9 |
| 7 | Validation d’une tâche autorisée | unitaire ; intégration 6-9 ; navigateur (vraie tâche + onglet Tests) |
| 8 | Refus d’une tâche terminée ou non attribuée | unitaire ; intégration 6-9 ; simulation |
| 9 | Progression cohérente | intégration 6-9 et 26-bis ; simulation (invariants) |
| 10 | Sabotage autorisé | unitaires ; intégration 10-11 |
| 11 | Sabotage refusé | unitaires ; intégration 10-11 (doublon, équipier, « portes » supprimé) |
| 12 | Délai d’élimination | unitaire ; intégration 12-13 |
| 13 | Refus d’éliminer un mort | unitaire ; intégration 12-13 ; simulation |
| 14 | Signalement d’un corps | unitaire ; intégration 14-18 ; navigateur |
| 15 | Actions interrompues en réunion | unitaire ; intégration 14-18 ; simulation (codes et défis effacés) |
| 16 | Ouverture / clôture du vote | unitaires ; intégration ; navigateur |
| 17 | Refus des votes doubles | unitaire ; intégration |
| 18 | Abstentions et égalités | unitaires (égalité, passer, égalité avec passer, abstentions, anonymat) |
| 19 | Règles des morts | unitaires ; intégration 19 ; simulation |
| 20 | Conditions de victoire | unitaires ; intégration 20 ; navigateur ; simulation (les 4 voies de victoire atteintes) |
| 21 | Reconnexion après actualisation | intégration 21-22 ; navigateur (`reload`) |
| 22 | Reconnexion après perte réseau | intégration 21-22 |
| 23 | Accès aux secrets sans autorisation | intégration 23 ; unitaires (clé privée VAPID jamais exposée) |
| 24 | Modification frauduleuse depuis le navigateur | intégration 24 ; simulation (91 548 actions invalides refusées) |
| 25 | Permissions d’administration | intégration 25 |
| 26 | Nombre maximal de joueurs (40) | unitaire ; intégration (+ refus du 41ᵉ) ; simulation (jusqu’à 40) |
| 27 | Fin de partie et nouvelle partie | unitaire ; intégration ; navigateur ; simulation (enchaînement de parties) |

Autres : outils du MJ (test des tâches via le serveur, test d’alerte, abonnements push) en intégration ; minuteur du serveur (expiration d’un code d’élimination sans aucune action) ; persistance après redémarrage du serveur.

## Ce qui n’a PAS pu être testé
- **Déploiement réel sur Cloudflare** (pas de compte) : les tests tournent sur `wrangler dev`, même moteur (workerd) et mêmes Durable Objects SQLite que la production.
- **Livraison réelle des notifications push** par Google/Apple/Mozilla : le chiffrement, la signature et le contenu sont testés, mais l’envoi vers ces services et l’affichage sur un vrai téléphone verrouillé ne peuvent pas l’être ici.
- **Vrais téléphones** (Safari iOS, Chrome Android) : seulement en émulation Chromium. Caméra (lecture de QR) non testée faute de caméra ; la saisie du code, solution de secours, est testée.
- **Son et vibration réels** : appels exécutés sans erreur, mais l’effet n’est pas mesurable automatiquement.
- **Installation PWA** et service worker : actifs uniquement en HTTPS, donc non exercés en local.
- **Wi-Fi réel** d’une maison avec 40 téléphones, et une soirée avec de vraies personnes : à faire lors d’une partie d’essai.

## Limites connues
- Présence physique au poste ou près de la victime non prouvée techniquement (règle d’honneur, journal, arbitrage du MJ).
- iPhone : pas de vibration ; notifications uniquement si le jeu est installé sur l’écran d’accueil.
- Un téléphone en veille sans notifications ne sonne pas : le MJ annonce les réunions à voix haute.
- Quotas gratuits remis à zéro chaque jour à 0 h UTC ; une partie de 40 joueurs en consomme quelques pourcents.
