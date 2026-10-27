# Guide du maître du jeu (MJ)

Le MJ ne joue pas : il prépare, présente la sécurité, surveille et arbitre. Son tableau de bord fonctionne sur téléphone comme sur ordinateur.

## 1. Créer la partie
1. Ouvrez le site → **Maître du jeu** → **Créer une nouvelle partie**.
2. Notez le **code maître du jeu** (ex. `ABCD-EFGH`) affiché dans l’onglet Partie : il permet de reprendre le tableau de bord depuis un autre appareil (« Reprendre une partie sur cet appareil »). Ne le montrez à personne.
3. Le terrain et les paramètres enregistrés sur votre appareil sont réutilisés automatiquement.

## 2. Préparer le terrain (onglet Terrain)
- **Pièces** : nom, étage, *Interdite*, *Passage* (escalier/couloir : pas de poste, pas d’élimination), *Cachette* autorisée, notes.
- **Générer postes et tâches automatiquement** : crée un poste de tâches par pièce jouable, le bouton d’urgence dans la salle de réunion, 2 postes Réacteur, 2 postes Oxygène, Énergie, Radio, Moniteur de vie, et 15 tâches. Vous pouvez tout modifier ensuite.
- **Postes** : nom, pièce, type ; chaque poste a un code imprimé. « ↻ » change le code (il faut alors réimprimer la fiche).
- **Tâches** : nom, type (commune / longue / courte), active ou non, étapes (poste + mini-jeu). Une tâche longue doit avoir ses étapes dans des pièces différentes.
- **Conduits** (facultatif) : itinéraires sûrs réservés aux imposteurs.
- **Consignes de sécurité** : texte affiché à tous dans le salon.
- **Enregistrer le terrain** : il est aussi mémorisé sur votre appareil ; **Exporter** crée un fichier de sauvegarde, **Importer** le recharge.
- **Vérifier une fiche imprimée** : scannez un QR code posé dans la maison pour contrôler qu’il correspond au bon poste.

Le terrain et les paramètres ne se modifient que dans le salon (pas pendant une manche).

## 3. Paramètres (onglet Paramètres)
Nombre d’imposteurs (conseil affiché selon le nombre de joueurs ; ils doivent rester strictement moins nombreux que l’équipage), délais d’élimination et de sabotage, durées des réunions, nombre de tâches, votes anonymes, confirmation des éjections, barre de tâches, tâches visuelles, disparition des corps, rôles visibles par les fantômes. Les valeurs officielles du jeu vidéo sont rappelées à côté de chaque champ.

**Réglages conseillés :**
| Joueurs | Imposteurs | Délai d’élimination | Discussion / vote |
|---|---|---|---|
| 8–12 | 2 | 60 s | 90 s / 90 s |
| 13–20 | 3–4 | 60 s | 120 s / 90 s |
| 21–30 | 4–5 | 75 s | 120 s / 120 s |
| 31–40 | 5–6 | 90 s | 150 s / 120 s |
Prévoyez au moins 1,5 poste de tâches par tranche de 4 joueurs pour éviter les embouteillages.

## 4. Imprimer (bouton Imprimer)
Affiche d’invitation (QR + code), fiches des postes (QR + code + énigmes papier), fiches spéciales (bouton d’urgence, réacteur, oxygène, énergie, radio, moniteur), étiquettes des pièces et panneaux « zone interdite » / « passage », badges fantômes, aide-mémoire. « Imprimer » → imprimante ou « Enregistrer en PDF ». Les codes restent valables d’une partie à l’autre tant que vous ne les régénérez pas.

## 5. Inviter
Montrez l’**affiche** ou le QR code de l’onglet Partie, ou utilisez **Partager le lien**. Les joueurs saisissent un pseudonyme. Verrouillez le salon une fois tout le monde arrivé. Un retardataire attendra la partie suivante (« Nouvelle partie » rouvre le salon).

## 6. Démarrer
1. Faites la **présentation de sécurité** (voir `securite-urgence.md`) et expliquez le résumé des règles.
2. Demandez à chacun de tester son appareil photo (salon → « Tester mon appareil photo »).
3. **Démarrer la partie** : les rôles sont tirés au hasard et chacun le découvre écran caché.

## 7. Pendant la partie (onglet Partie)
- **Pause générale** / **Reprendre** : gèle tous les minuteurs ; aucune action possible.
- **ARRÊT D’URGENCE** : écran STOP rouge sur tous les téléphones (procédure dans `securite-urgence.md`).
- **Sabotage en cours** : état des postes, mains posées au réacteur, bouton « Annuler le sabotage ».
- **Réunion** : étape en cours, arrivées, votes en direct (vous seul les voyez), boutons *Étape suivante*, *+30 s*, *−30 s*.
- **Convoquer une réunion** : pour un corps dont le téléphone ne fonctionne plus, ou un litige.
- **Fin de partie manuelle** : victoire équipage, imposteurs, ou sans vainqueur (avertissement de confirmation).
- **Alertes sécurité** : bandeau rouge et sonnerie ; touchez « Vu » après avoir réagi.

## 8. Joueurs (onglet Joueurs)
Statut (vivant, mort, éjecté, corps non trouvé, déconnecté 🟢/⚪), tâches. « Afficher les rôles » : ne cochez que si personne ne voit votre écran. **Gérer** un joueur :
- **Code de reconnexion** : pour un joueur qui a changé de téléphone ou vidé son navigateur (15 min, usage unique ; l’ancien appareil est déconnecté).
- **Déclarer mort·e** (téléphone en panne, élimination validée oralement), **Annuler la mort** (élimination injustifiée), **A quitté la partie**, valider/réinitialiser une **tâche**, **Exclure**.
Chaque correction modifie l’équilibre de la partie : une confirmation est demandée et l’action est inscrite au journal.

## 9. Arbitrage
- **Élimination contestée** : écoutez les deux joueurs séparément ; le journal (onglet Journal, « Afficher les événements secrets ») indique les codes armés, les éliminations et les codes erronés avec l’heure. Annulez si la règle n’a pas été respectée (escalier, pendant une réunion, à distance…).
- **Fantôme qui parle** : avertissement, puis exclusion.
- **Codes erronés à répétition** (blocage automatique d’une minute, signalé dans le journal) : possible tentative de triche.
- **Téléphone déchargé** : déclarez la mort si le joueur est éliminé, sinon donnez-lui un code de reconnexion sur un autre téléphone, ou « A quitté la partie ».
- **Coupure Internet générale** : mettez en pause, attendez le retour du réseau (les téléphones se reconnectent seuls), reprenez.

## 10. Après la partie
L’écran de fin montre le vainqueur, la raison, tous les rôles, les éliminations, les réunions et votes, les sabotages. **Nouvelle partie** ramène tout le monde au salon avec les mêmes joueurs, le même terrain et les mêmes paramètres. Pour une nouvelle soirée, créez une nouvelle partie : votre terrain est rechargé automatiquement.
