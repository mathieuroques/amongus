# Guide du maître du jeu (MJ)

Le MJ ne joue pas : il prépare, présente la sécurité, surveille et arbitre. Son tableau de bord fonctionne sur téléphone comme sur ordinateur.

## 1. Créer la partie
1. Ouvrez le site → **Maître du jeu** → **Créer une nouvelle partie**.
2. Notez le **code maître du jeu** (ex. `ABCD-EFGH`) affiché dans l’onglet Partie : il permet de reprendre le tableau de bord depuis un autre appareil (« Reprendre une partie sur cet appareil »). Ne le montrez à personne.
3. Le terrain et les paramètres enregistrés sur votre appareil sont réutilisés automatiquement.

## 2. Préparer le terrain (onglet Terrain)
- **Pièces** : nom, étage, *Interdite*, *Passage* (escalier/couloir : pas de poste, pas d’élimination), *Cachette* autorisée, notes.
- **Générer postes et tâches automatiquement** : crée un poste de tâches par pièce jouable, le bouton d’urgence dans la salle de réunion, 2 postes Réacteur, 2 postes Oxygène, Énergie, Radio, Moniteur de vie, et 15 tâches. Vous pouvez tout modifier ensuite.
- **Imprimer avant de connaître la maison** : crée des pièces provisoires (« Pièce A », « Pièce B »…) et des postes nommés par lettre. Imprimez chez vous (prévoyez large), puis sur place renommez les pièces : les postes suivent et les codes ne changent pas ; **🧹 Retirer les fiches non posées** supprime le surplus et reporte ses tâches sur les postes posés (détails dans [Installer la maison](installation-terrain.md)).
- **Postes** : nom, pièce, type ; chaque poste a un code imprimé. « ↻ » change le code (il faut alors réimprimer la fiche).
- **Tâches** : nom, type (commune / longue / courte), active ou non, étapes (poste + mini-jeu). Une tâche longue doit avoir ses étapes dans des pièces différentes.
- **Conduits** (facultatif, aucun par défaut) : itinéraires sûrs réservés aux imposteurs. Ne les activez que si la maison offre un second chemin éclairé et sans marche.
- **Consignes de sécurité** : texte affiché à tous dans le salon.
- **Enregistrer le terrain** : il est aussi mémorisé sur votre appareil ; **Exporter** crée un fichier de sauvegarde, **Importer** le recharge.

Le terrain et les paramètres ne se modifient que dans le salon (pas pendant une manche).

Des **conseils** s’affichent (poste sans tâche, pièce sans poste, tâche longue dont les deux étapes sont dans la même pièce, sabotages désactivés faute de postes).

## 3. Paramètres (onglet Paramètres)
Trois **préréglages** en un geste : *Petit groupe (≤ 12)*, *Groupe moyen (13–24)*, *Grande partie (25–40)* ; le nombre d’imposteurs est ajusté au nombre d’inscrits (bouton « Appliquer le conseil »).
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
Affiche d’invitation (QR + code), fiches des postes (QR + code + énigmes papier), fiches spéciales (bouton d’urgence, réacteur, oxygène, énergie, radio, moniteur), étiquettes des pièces et panneaux « zone interdite » / « passage », badges fantômes, aide-mémoire. « Imprimer » → imprimante ou « Enregistrer en PDF ». La case **« Laisser le nom de la pièce en blanc »** imprime une ligne à remplir à la main au lieu du nom de la pièce (cochée d’office quand le terrain a été préparé sans connaître la maison). Les codes restent valables d’une partie à l’autre tant que vous ne les régénérez pas.

> **Énigmes papier (mise à jour)** : la grille « inventaire » est inchangée (vos anciennes fiches restent utilisables, la nouvelle impression ajoute seulement les repères A–F / 1–8 et les traits des moitiés), mais les **bandes « puzzle » portent désormais deux lettres** (haut et bas) : **réimprimez et redécoupez** les fiches qui contiennent un puzzle (« Puzzle », « Énigme du coffre »).

## 4 bis. Tester (onglet 🧪 Tests)
- **Faire sonner tous les téléphones** : chaque joueur doit entendre/voir l’alerte ; les autres règlent leurs alertes.
- **Vérifier une fiche posée** : scannez un QR code dans la maison ; l’application indique le poste et ce qu’on peut y tester.
- **Toutes les tâches** : chaque étape de chaque tâche se lance réellement (validée par le serveur, sans effet sur la partie). Pour les énigmes papier, la question est tirée au hasard (comme en partie) et la **réponse attendue** s’affiche : comparez avec la fiche imprimée (relancez le test pour voir d’autres questions). Chaque test réussi est coché ✅ ; l’onglet Partie indique « Tâches testées x/y ».
- **Réparations** : énergie, radio, oxygène. Le réacteur se teste à deux, pendant une partie d’essai.

## 5. Inviter
Montrez l’**affiche** ou le QR code de l’onglet Partie, ou utilisez **Partager le lien**. Les joueurs saisissent un pseudonyme. Verrouillez le salon une fois tout le monde arrivé. Un retardataire attendra la partie suivante (« Nouvelle partie » rouvre le salon).

## 6. Démarrer
L’onglet Partie affiche une **liste de préparation** : terrain, réglages, fiches posées, tâches testées, joueurs connectés et alertes, sécurité présentée.
1. Faites la **présentation de sécurité** (voir `securite-urgence.md`) et expliquez le résumé des règles.
2. Demandez à chacun de régler ses alertes et de tester son appareil photo (cartes du salon). Faites sonner tous les téléphones.
3. **Démarrer la partie** : les rôles sont tirés au hasard et chacun le découvre écran caché.
4. Pendant toute la partie, **annoncez les réunions à voix haute** en plus des téléphones (voir `alertes-notifications.md`).

## 7. Pendant la partie (onglet Partie)
Une **barre d’état** reste toujours visible en haut : phase et chrono, sabotage en cours, vivants, progression, boutons **Pause** et **STOP**.
- **Pause générale** / **Reprendre** : gèle tous les minuteurs ; aucune action possible.
- **ARRÊT D’URGENCE** (STOP) : écran rouge sur tous les téléphones (procédure dans `securite-urgence.md`).
- **Faire sonner tous les téléphones** : utile pour rappeler tout le monde.
- **Sabotage en cours** : état des postes, mains posées au réacteur, bouton « Annuler le sabotage ».
- **Réunion** : étape en cours, arrivées, « prêts à voter », votes en direct (vous seul les voyez), boutons *Étape suivante*, *+30 s*, *−30 s*. Le rassemblement se raccourcit seul à 15 s dès que la majorité est arrivée, et le vote s’ouvre dès que la majorité est « prête à voter » : *+30 s* reste possible pour un retardataire.
- **Convoquer une réunion** : pour un corps dont le téléphone ne fonctionne plus, ou un litige.
- **Fin de partie manuelle** : victoire équipage, imposteurs, ou sans vainqueur (avertissement de confirmation).
- **Alertes sécurité** et **contestations d’élimination** : écran d’alerte, sonnerie, bandeau rouge (et notification si votre téléphone est verrouillé et les notifications activées) ; touchez « Vu » après avoir réagi. La notification d’une contestation ne nomme pas l’imposteur (elle peut s’afficher sur l’écran verrouillé) : son nom est dans le bandeau du tableau de bord.

## 8. Joueurs (onglet Joueurs)
Cartes filtrables (tous, vivants, morts, déconnectés) : statut (vivant, mort, éjecté, corps non trouvé), connexion 🟢/⚪, notifications 🔔, tâches. « Afficher les rôles » : ne cochez que si personne ne voit votre écran. **Gérer** un joueur :
- **Code de reconnexion** : pour un joueur qui a changé de téléphone ou vidé son navigateur (15 min, usage unique ; l’ancien appareil est déconnecté).
- **Déclarer mort·e** (téléphone en panne, élimination validée oralement), **Annuler la mort** (élimination injustifiée), **A quitté la partie**, valider/réinitialiser une **tâche**, **Exclure**.
Chaque correction modifie l’équilibre de la partie : une confirmation est demandée et l’action est inscrite au journal.

## 9. Arbitrage
- **Élimination contestée** : la victime touche « Je n’ai pas été touché·e (contester) » ; vous recevez une alerte « CONTESTATION » avec le nom de l’imposteur. Écoutez les deux joueurs séparément ; le journal (onglet Journal, « Afficher les événements secrets ») indique l’heure de chaque élimination et de la contestation. Annulez (Joueurs → Gérer → « Annuler la mort ») si la règle n’a pas été respectée (pas de contact, escalier, à distance…). Une erreur de pseudonyme de l’imposteur se corrige de la même façon.
- **Fantôme qui parle** : avertissement, puis exclusion.
- **Codes erronés à répétition** (blocage automatique d’une minute, signalé dans le journal) : possible tentative de triche.
- **Téléphone déchargé** : déclarez la mort si le joueur est éliminé, sinon donnez-lui un code de reconnexion sur un autre téléphone, ou « A quitté la partie ».
- **Coupure Internet générale** : mettez en pause, attendez le retour du réseau (les téléphones se reconnectent seuls), reprenez.

## 10. Après la partie
L’écran de fin montre le vainqueur, la raison, tous les rôles, les éliminations, les réunions et votes, les sabotages. **Nouvelle partie** ramène tout le monde au salon avec les mêmes joueurs, le même terrain et les mêmes paramètres. Pour une nouvelle soirée, créez une nouvelle partie : votre terrain est rechargé automatiquement.
