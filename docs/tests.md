# Rapport de tests

*Exécutés le 28/10/2026 (Linux, Node 22, wrangler 4.153 / workerd local, Chromium Playwright). Commandes : `npm run typecheck`, `npm test`, `npx vitest run --coverage`, `npm run test:integration`, `npm run test:browser`, `SIM_GAMES=300 npx vitest run test/simulation.test.ts`.*

## Résultats

| Suite | Contenu | Résultat |
|---|---|---|
| Vérification des types | client + serveur (TypeScript strict) | ✅ aucune erreur |
| Moteur de règles (`test/engine.test.ts`) | règles, transitions, vues filtrées, corrections du MJ, élimination par choix et contestation, fausses tâches, ordre et proximité des tâches, réunions (majorité, prêt à voter), panne de courant | ✅ **62/62** |
| Modules (`test/modules.test.ts`) | les 11 mini-jeux et 3 réparations (bonne réponse acceptée, mauvaises refusées, réponses papier jamais envoyées), énigmes imprimées, codes et aléatoire, paramètres hors bornes, terrain (génération 1 à 25 pièces, 500 terrains malformés), notifications (contenu public uniquement), outils de test du MJ, abonnements push, énigmes à questions tirées au hasard, lecture des QR codes | ✅ **40/40** |
| Connexion (`test/net.test.ts`) | action gardée pendant une reconnexion (faux WebSocket, horloge simulée) : coupure courte, longue, connexion « fantôme » au retour de veille, plusieurs actions, fermeture | ✅ **6/6** |
| Notifications push (`test/webpush.test.ts`) | chiffrement identique **au vecteur officiel de la RFC 8291**, jeton VAPID vérifié, refus des hôtes inconnus, aller-retour complet (déchiffrement côté téléphone) | ✅ **4/4** |
| Fiches imprimées à l’avance (`test/printed.test.ts`) | code de récupération (2 000 allers-retours, saisie tolérante), génération figée, 1 à 40 fiches × 25 tirages (aucune fiche sans tâche, énigmes papier, scan et fiches spéciales sur A à F), **372 poses sur place** (10 à 40 fiches imprimées, 6 à toutes posées, dans le désordre, deux fiches dans une pièce, fiche spéciale déplacée) : aucune trace des fiches non posées, énigmes jamais déplacées, tous les sabotages possibles, démarrage possible avec les 4 préréglages de 4 à 40 joueurs, retrait idempotent, remise puis retrait identiques ; 40 parties démarrées sur ces terrains (aucune tâche sur une fiche non posée, aucune pièce provisoire visible) | ✅ **9/9** |
| Simulation aléatoire (`test/simulation.test.ts`) | parties complètes jouées par des agents (dont 15 séries sur des terrains issus de fiches imprimées à l’avance) (actions sensées, erreurs, tentatives de triche, pauses, corrections du MJ), invariants vérifiés après **chaque** action, vues de chaque joueur inspectées | ✅ 40 séries par défaut ; **300 séries : 1 064 parties terminées, 93 671 actions invalides refusées, 0 erreur inattendue** (111 victoires par les tâches, 565 par éjection, 84 par parité, 304 par sabotage critique) |
| Couverture du moteur partagé (`src/shared`) | lignes exécutées par les tests ci-dessus | **96,6 % des lignes, 89,1 % des branches, 98,4 % des fonctions** |
| Intégration (`test/integration/game.test.ts`) | vrai serveur local (Worker + Durable Object SQLite) + **41 WebSockets** (MJ + 40 joueurs) | ✅ **17/17** (~74 s) |
| Intégration, fiches imprimées (`test/integration/printed.test.ts`) | 30 fiches imprimées, 12 posées : démarrage refusé tant que des pièces sont provisoires, fiches non posées refusées au scan, l’équipage termine toutes ses tâches sur les seules fiches posées et gagne, récupération dans une nouvelle partie avec le seul code | ✅ **5/5** (~30 s) |
| Navigateur (`test/browser/ui.test.ts`) | Chromium : MJ sur ordinateur et téléphone, 5 téléphones (iPhone 13) puis 5 en 360×640, caméras simulées filmant de vrais QR codes, coupures réseau réelles, parcours complet par l’interface | ✅ **15/15** (~155 s) |
| Navigateur, fiches imprimées (`test/browser/printed.test.ts`) | bouton de l’onglet Terrain (enregistrement immédiat, code de récupération), page d’impression (aucun nom de pièce, liste de tâches, code de partie ni réglage imprimé ; une fiche par poste ; croix du scan sur la bonne fiche ; plan de pose), 14 pièces renommées et retrait, remise des fiches retirées, code saisi à la main, téléphone d’un joueur sans aucune fiche non posée | ✅ **6/6** |

### Ce que vérifie le test navigateur
- Accueil, création de partie, arrivée par le lien d’invitation (pseudonyme seul).
- Salon : test du son, entraînement local à un mini-jeu.
- **Onglet Tests du MJ : les 19 étapes de tâches du terrain d’exemple et les 3 réparations (22 vérifications) sont jouées par l’interface et validées par le serveur — les 11 mini-jeux et les 3 réparations sont donc tous exercés de bout en bout.**
- Préréglage et paramètres, « Faire sonner tous les téléphones » reçu par les 5 téléphones (écran d’alerte).
- Démarrage, révélation du rôle ; **personne n’est envoyé d’abord à la tâche commune** ; l’onglet Rôle a la même apparence pour tous (deux voiles, aucune couleur d’imposteur).
- **Vraie tâche** par saisie du code : si une seule tâche se fait à ce poste, le mini-jeu s’ouvre d’office (sinon panneau du poste) ; après validation, retour direct à l’onglet Tâches avec « Prochaine étape » ; le téléphone ne reçoit jamais la réponse.
- **Fausse tâche d’un imposteur** : même message que l’équipier (« Tâche terminée ! » / « Étape validée ! »), compteur de l’onglet qui baisse, liste qui avance ; la barre de l’équipage ne bouge pas.
- **Caméra réelle simulée** : un Chromium dont la webcam filme un vrai QR code (vidéo générée par le test) ; la caméra s’ouvre seule sur l’onglet Poste, le lecteur décode l’image et la tâche démarre sans aucune saisie. Une 2ᵉ caméra filme l’affiche d’invitation pendant 8 s : message « Ce QR code n’est pas celui d’un poste », **aucun code erroné compté, aucun blocage**.
- **Coupures réseau réelles** (relais WebSocket contrôlé par le test) : action faite pendant une coupure de 2 s → bandeau « Reconnexion… » immédiat, puis l’action part **une seule fois** au retour ; coupure de plus de 5 s → refus clair, et l’action n’est **jamais** envoyée après coup.
- **Élimination par choix du pseudonyme** : panneau d’actions neutre (pas de carte de rôle, pas de rouge, pas le mot « IMPOSTEUR »), alliés absents de la liste, barre de confirmation ; la victime n’a rien à saisir, son écran devient un corps (code en très gros + QR code) et **vibre** ; l’imposteur reçoit **une courte vibration** quand son élimination redevient possible.
- **Corps signalé en filmant le QR code** affiché par le téléphone du corps (2ᵉ caméra simulée), confirmation, écran « RÉUNION ! » sur tous les téléphones, rappel du badge fantôme, rassemblement, **« Prêt à voter » : le vote s’ouvre dès que 3 vivants sur 4 sont prêts** (discussion réglée à 120 s), vote avec barre de confirmation, annonce du rôle de l’éjecté, écrans « Vous avez gagné / perdu », écran de fin du MJ.
- Nouvelle partie, rechargement de page (rôle conservé), pause, arrêt d’urgence, reprise avec confirmation, cartes joueurs du MJ.
- **Petits écrans 360×640** : accueil, règles, tableau de bord du MJ, puis **chaque onglet de chaque joueur**, le panneau d’actions, la carte de rôle et l’écran du corps (code sur une seule ligne, ≥ 56 px) : aucun défilement horizontal. Génération du PDF des supports.
- **Aucune erreur JavaScript** sur l’ensemble des pages pendant tout le test.

## Bugs trouvés et corrigés grâce à ces tests
- *Version 2 (fluidité)* : la caméra relancée automatiquement relisait en boucle un QR code refusé (affiche d’invitation, fiche d’une autre partie) ; chaque lecture comptait comme code erroné et bloquait le joueur 60 s. Corrigé : un QR code qui n’est ni un poste ni un corps est ignoré sans rien envoyer, et un QR code refusé n’est pas relu pendant 15 s.
- *Version 2* : le raccourcissement du rassemblement à 15 s annulait une prolongation « +30 s » du MJ à l’arrivée suivante. Corrigé : il ne s’applique qu’une fois.
- *Version 2* : le code du corps passait à la ligne sur un iPhone (« 246 / 2 »). Corrigé et vérifié en 360 px.
- *Version 2* : la simulation monopolisait le processus de test au point de dépasser un délai interne de vitest ; elle rend désormais la main entre deux séries.
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
| 24 | Modification frauduleuse depuis le navigateur | intégration 24 ; simulation (93 671 actions invalides refusées) |
| 25 | Permissions d’administration | intégration 25 |
| 26 | Nombre maximal de joueurs (40) | unitaire ; intégration (+ refus du 41ᵉ) ; simulation (jusqu’à 40) |
| 27 | Fin de partie et nouvelle partie | unitaire ; intégration ; navigateur ; simulation (enchaînement de parties) |

Autres : outils du MJ (test des tâches via le serveur, test d’alerte, abonnements push) en intégration ; minuteur du serveur (rassemblement raccourci à 15 s par l’alarme du Durable Object dès que la majorité a pointé) ; panne de courant (tâches possibles, signalement refusé) ; contestation d’élimination reçue par le MJ seul ; persistance après redémarrage du serveur.

### Nouveautés de la version 2 et tests correspondants
| Changement | Unitaires / simulation | Intégration | Navigateur |
|---|---|---|---|
| Élimination par choix du pseudonyme, contestation | délais, alliés, morts, partis, soi-même, inconnus, refus sans consommer le délai ; le tueur seul voit sa victime morte ; une contestation par mort ; notifications sans nom | ✅ | ✅ |
| Panneau d’actions neutre, vibrations « prêt » | — | — | ✅ (vibrations enregistrées) |
| Fausses tâches identiques | même réponse, même progression, jamais de victoire par les tâches d’un imposteur ; simulation : jamais de progression de la barre | ✅ | ✅ |
| Ordre personnel, prochaine étape proche | commune jamais en tête (300 tirages), 40 joueurs répartis sur ≥ 4 postes, proximité même pièce/même étage | ✅ | ✅ |
| Caméra automatique, tâche lancée d’office, prochaine étape | lecture des QR codes (postes, corps, QR inconnus) | — | ✅ caméra simulée |
| Action gardée pendant la reconnexion | 6 tests avec un faux WebSocket (coupure courte, longue, connexion fantôme au retour de veille, plusieurs actions, fermeture) ; vérifiés par mutation (le test échoue si la logique est retirée) | — | ✅ coupures réelles |
| Rassemblement 15 s, « Prêt à voter » | majorité, prolongation du MJ respectée, morts/partis non comptés ; simulation : invariants à chaque action | ✅ (alarme) | ✅ |
| Corps lisible de loin / QR, badge après la réunion | corps disparu : mort non annoncée jusqu’à la réunion | — | ✅ (360 px) |
| Panne de courant : signalements impossibles | mini-jeu en cours conservé, nouvelles tâches possibles, signalement refusé sans compter d’erreur, possible après réparation | ✅ | — |
| Énigmes à plusieurs questions | 30 questions par grille, réponses exactes, moitiés cohérentes, jamais de réponse nulle, grille identique à l’ancienne impression (2 000 graines comparées) ; 2 mots par jeu de bandes | ✅ | ✅ (onglet Tests du MJ) |

## Ce qui n’a PAS pu être testé
- **Déploiement réel sur Cloudflare** (pas de compte) : les tests tournent sur `wrangler dev`, même moteur (workerd) et mêmes Durable Objects SQLite que la production.
- **Livraison réelle des notifications push** par Google/Apple/Mozilla : le chiffrement, la signature et le contenu sont testés, mais l’envoi vers ces services et l’affichage sur un vrai téléphone verrouillé ne peuvent pas l’être ici.
- **Vrais téléphones** (Safari iOS, Chrome Android) : seulement en émulation Chromium. La lecture de QR code est testée avec une **caméra simulée** (vidéo d’un vrai QR code, décodée par le lecteur jsQR de l’application) ; BarcodeDetector (Android) et la caméra de Safari ne peuvent pas l’être ici.
- **Son et vibration réels** : les vibrations demandées sont enregistrées et vérifiées (victime, imposteur « prêt »), mais l’effet physique n’est pas mesurable automatiquement.
- **Installation PWA** et service worker : actifs uniquement en HTTPS, donc non exercés en local.
- **Wi-Fi réel** d’une maison avec 40 téléphones, et une soirée avec de vraies personnes : à faire lors d’une partie d’essai.

## Limites connues
- Présence physique au poste ou près de la victime non prouvée techniquement (règle d’honneur, journal, arbitrage du MJ).
- L’élimination par choix du pseudonyme ne prouve pas la proximité : une élimination à distance est interdite par le règlement, la victime peut la contester et le MJ l’annuler.
- Vibrations « prêt » de l’imposteur et de la victime : Android uniquement (aucune vibration depuis une page web sur iPhone).
- Les anciennes bandes « puzzle » (une seule lettre par bande) doivent être réimprimées ; les anciennes grilles « inventaire » restent utilisables.
- iPhone : pas de vibration ; notifications uniquement si le jeu est installé sur l’écran d’accueil.
- Un téléphone en veille sans notifications ne sonne pas : le MJ annonce les réunions à voix haute.
- Quotas gratuits remis à zéro chaque jour à 0 h UTC ; une partie de 40 joueurs en consomme quelques pourcents.
