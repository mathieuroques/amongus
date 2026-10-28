# Recherche : règles officielles d’Among Us et matrice d’adaptation

*Recherche effectuée le 27 octobre 2026. Version du jeu en vigueur à cette date : **v19.0.0** (annoncée par Innersloth le 29 septembre 2026).*

Ce document résume, **avec nos propres mots**, les règles du jeu vidéo (aucun texte, image ou son d’Innersloth n’est reproduit), indique leur degré de certitude, puis décrit l’adaptation retenue pour une maison et la façon dont l’application l’implémente.

## 1. Sources consultées

| Source | Type | Ce qu’elle confirme |
|---|---|---|
| [innersloth.com — page du jeu Among Us](https://www.innersloth.com/games/among-us/) | Officielle (éditeur) | Rôles équipage / imposteurs, objectifs (« remplir la barre de tâches ou éjecter les imposteurs » ; « éliminer l’équipage »), sabotages, réunions d’urgence, vote d’éjection, bouches d’aération, fermeture de portes, 4 à 15 joueurs. |
| [innersloth.com — Emergency Meeting #44 (29/09/2026)](https://www.innersloth.com/new-ghost-crewmate-role-the-influencer-emergency-meeting-44/) | Officielle (notes de version v19.0.0) | Version actuelle ; nouveau rôle fantôme « Influencer » ; rappel que les fantômes font leurs tâches ; aucune modification des règles classiques. |
| [innersloth.com — Behind the Beans : Judge (09/09/2026)](https://www.innersloth.com/behind-the-beans-judge/) | Officielle | Rôle « Judge » (capacité en réunion), rôles abandonnés (Captain, Skip Stopper). |
| [innersloth.com/news](https://www.innersloth.com/news/) | Officielle | Chronologie des mises à jour récentes. |
| Wiki communautaire Among Us (among-us.fandom.com), pages *Options, Voting, Ejection, Emergency meeting, Emergency button, Report, Kill, Sabotage, Ghost, Tasks, Task bar, Victory, Impostor, Roles* (consultées via l’API du wiki, contenu à jour d’octobre 2026) | Secondaire spécialisée | Valeurs par défaut et plages des options, cas limites (égalités, abstention, signalement pendant un sabotage, délais), comportement des fantômes. |
| [Cloudflare — tarifs Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [limites Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/), [fichiers statiques](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [changelog DO gratuit 07/04/2025](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/) | Officielle (hébergeur) | Quotas gratuits (voir `conception.md`). |

**Limites de la recherche.** Innersloth ne publie pas de manuel détaillé des règles : les mécaniques fines (valeurs par défaut, égalités, abstentions, délais initiaux) ne sont documentées que par la communauté. Elles sont marquées **« secondaire »** ci-dessous. Le site officiel confirme les grandes lignes ; aucune contradiction n’a été trouvée entre sources officielles et secondaires.

Légende de certitude : **✅ officiel** (source Innersloth) · **🟡 secondaire concordant** (wiki à jour, cohérent avec l’officiel) · **⚠️ incertain** (sources partielles ou divergentes).

## 2. Classement des règles

### A. Noyau classique (reproduit)
Rôles équipage/imposteurs secrets, tâches (communes, courtes, longues) et barre de progression commune, élimination avec délai, corps et signalement, réunions d’urgence limitées, discussion puis vote (passer possible, égalité = personne), annonce optionnelle du rôle de l’éjecté, fantômes (tâches pour l’équipage, sabotage pour les imposteurs), sabotages critiques et non critiques, conditions de victoire.

### B. Options officielles (configurables dans l’application)
Nombre d’imposteurs, délai d’élimination, distance d’élimination, nombre de réunions d’urgence, délai du bouton, temps de discussion et de vote, votes anonymes, confirmation des éjections, mise à jour de la barre de tâches (toujours / réunions / jamais), nombre de tâches communes/longues/courtes, tâches visuelles, vision, vitesse.

### C. Rôles spéciaux, extensions et variantes (NON inclus dans la version 1)
- Équipage : Scientifique, Ingénieur, Bruiteur (Noisemaker), Traqueur (Tracker), Détective (v17.0.0), Juge (2026), et rôles fantômes Ange gardien et Influenceur (v19.0.0).
- Imposteurs : Métamorphe (Shapeshifter), Fantôme (Phantom), Vipère (Viper, v17.0.0).
- Mode « Cache-cache » (Hide n Seek), mode « Rôles à gogo » (préréglage).

Ils sont identifiés mais **volontairement exclus** de la version livrée, jouable avec le seul noyau classique. Plusieurs reposent sur des informations de position (traqueur, bruiteur, métamorphe) qu’une maison réelle ne fournit pas sans géolocalisation intérieure.

## 3. Matrice des règles

Pour chaque mécanique : fonctionnement officiel → déclenchement → restrictions → effets → adaptation physique → solution technique → différences inévitables.

### 1. Attribution et confidentialité des rôles — ✅
- **Officiel** : au lancement, des joueurs tirés au hasard deviennent imposteurs (1 à 3) ; chacun voit son rôle seul ; les imposteurs se reconnaissent entre eux. Chaque joueur a la même probabilité d’être imposteur (🟡).
- **Maison** : rôle révélé sur le téléphone derrière un voile « cachez votre écran, touchez pour voir ».
- **Technique** : tirage par `crypto.getRandomValues` (mélange de Fisher-Yates sans biais) côté serveur ; chaque téléphone reçoit une vue filtrée : son rôle, et pour un imposteur la liste de ses alliés. Les rôles des autres n’existent pas dans les données envoyées (testé). L’écran « Rôle » est masqué par défaut et se recache après 8 s.
- **Différence** : jusqu’à 40 joueurs, donc plus d’imposteurs que les 3 du jeu (conseil : 1 pour 6 joueurs environ ; maximum strictement inférieur à la moitié).

### 2. Objectifs de l’équipage — ✅
- Accomplir toutes les tâches **ou** éjecter tous les imposteurs.
- **Technique** : les deux conditions sont vérifiées par le serveur après chaque action.

### 3. Objectifs des imposteurs — ✅ / 🟡
- Éliminer jusqu’à ce que les imposteurs vivants soient **aussi nombreux** que l’équipage vivant (🟡 formulation exacte : « jusqu’à ce que l’équipage n’ait plus la majorité ») **ou** faire échouer un sabotage critique (✅ page officielle : sabotages ; 🟡 pour le détail).
- **Technique** : `checkWin` (parité) et expiration du compte à rebours critique (`tick`).

### 4. Tâches communes, courtes et longues — 🟡
- **Officiel** : chaque joueur reçoit N tâches communes (identiques pour tous, max 2), longues (max 3, plusieurs étapes à des endroits différents) et courtes (max 5). Les imposteurs ont une **liste factice** (qui inclut les tâches communes) et ne peuvent rien accomplir.
- **Maison** : postes physiques (fiche avec QR code + code court) répartis dans les pièces ; mini-jeux sur téléphone ou énigmes imprimées (compter des symboles, reconstituer un mot découpé).
- **Technique** : attribution aléatoire selon les paramètres ; une étape ne démarre que si le **code du poste** est saisi/scanné au bon endroit ; le serveur génère le défi, garde la réponse, impose une durée minimale et valide une seule fois (tests de double validation).
- **Différence** : le serveur ne peut pas prouver la présence physique (une photo du code permet de tricher) → règle d’honneur + journal des codes erronés + blocage temporaire après 6 erreurs.

### 5. Progression globale — 🟡
- Barre commune = tâches terminées / tâches de l’équipage. Options : *toujours*, *pendant les réunions*, *jamais*. Masquée pendant les communications coupées. Les tâches d’un joueur qui quitte la partie sont retirées du total.
- **Technique** : identique (y compris le retrait des tâches des joueurs partis).

### 6. Élimination — ✅ / 🟡
- **Officiel** : un imposteur vivant élimine un équipier proche (distance courte/moyenne/longue) ; délai 10 à 60 s (45 s par défaut), **10 s au premier tour**, remis au maximum après chaque élimination et chaque réunion ; impossible pendant une réunion ; pas d’élimination d’un imposteur ni d’un fantôme ; la victime laisse un corps.
- **Maison** : voir `conception.md` §4 (analyse de 6 méthodes). Retenu : **l’imposteur choisit le pseudonyme de sa victime** après l’avoir touchée ; la victime n’a rien à saisir et peut contester auprès du MJ. (La première version utilisait un code à 4 chiffres saisi par la victime : trop long et trop visible en pratique.)
- **Technique** : refus si le délai n’est pas écoulé, pendant une réunion ou une pause, pour un mort, un joueur parti, soi-même ou un allié (l’imposteur connaît déjà ses alliés : aucune fuite) ; un refus ne consomme pas le délai ; une contestation par mort.
- **Différence** : délais allongés par défaut (60 s, premier : 30 s) car les joueurs marchent ; la proximité est garantie par le geste physique, pas par le téléphone.

### 7. Sabotages — 🟡
| Officiel | Effet | Réparation officielle | Adaptation retenue |
|---|---|---|---|
| Réacteur / Stabilisateurs (critique) | compte à rebours 30–60 s | 2 joueurs posent la main **simultanément** sur 2 scanners | 2 postes « Réacteur » ; deux joueurs **vivants et distincts** maintiennent un bouton en même temps pendant 2,5 s. Défaut : 75 s. |
| Oxygène / Crash (critique) | compte à rebours 30–45 s | code saisi sur **2 claviers** distincts | 2 postes « Oxygène » ; à chacun, un code PIN affiché à recopier. Défaut : 90 s. |
| Lumières | vision de l’équipage très réduite | interrupteurs sur un tableau | **Panne de courant** : « dans le noir, on ne voit pas les corps » — aucun signalement de corps possible tant qu’elle dure (les tâches continuent ; aucune vraie lumière coupée). Comme dans le jeu, elle ouvre une fenêtre d’élimination aux imposteurs. Réparation au poste « Énergie (fictif) » : 5 interrupteurs virtuels. |
| Communications | liste des tâches, barre, caméras, admin, vitales indisponibles | régler une fréquence / 2 claviers | Liste des tâches et barre masquées, moniteur de vie indisponible. Réparation au poste « Radio » : aligner deux ondes. |
| Portes | salle fermée ~10 s | se rouvrent seules (ou manuellement selon la carte) | **Non reproduit** (retiré après essai) : une porte réelle ne se ferme ni ne se rouvre toute seule, et on ne verrouille jamais une porte. Une simple « interdiction d’entrer » n’était ni vérifiable ni perceptible (personne ne sait quand la salle « se rouvre »). Voir `limites-mecaniques.md`. |
- Règles communes (🟡) : un seul sabotage à la fois ; délai partagé 30 s (10 s au début) qui démarre à la réparation ; les imposteurs fantômes peuvent saboter ; **les fantômes ne réparent pas** ; le bouton d’urgence est bloqué pendant un sabotage (sauf portes, absentes ici) ; **signaler un corps interrompt un sabotage critique** (les lumières/communications persistent).
- **Différence** : jamais de vraie coupure, de porte fermée à clé ou d’obscurité.

### 8. Réparations à plusieurs endroits — 🟡
- Réacteur : simultanéité exigée → bouton maintenu + battement toutes les secondes ; une main par joueur ; une main « périmée » (5 s sans battement, ex. réseau coupé) ne compte plus.
- Oxygène : deux postes, une ou plusieurs personnes, dans le délai.

### 9. Signalement des corps — ✅ / 🟡
- **Officiel** : tout joueur vivant proche d’un corps peut le signaler → réunion ; possible pendant un sabotage ; tous les autres corps disparaissent à la réunion ; un fantôme ne signale pas.
- **Maison** : la victime reste assise sur place (hors escalier) en affichant son **code de corps** ; celui qui la trouve saisit ce code.
- **Technique** : code de corps unique ; refusé s’il est déjà signalé ou disparu ; les corps non signalés disparaissent à la réunion. Option : un corps non trouvé « disparaît » après 3 min (réglable, 0 = jusqu’à la réunion) pour que la victime ne reste pas assise indéfiniment.

### 10. Réunions d’urgence — 🟡
- **Officiel** : bouton dans la salle de réunion ; N réunions par joueur (1 par défaut) ; délai 15 s après chaque réunion ; interdit pendant un sabotage (sauf portes) ; un fantôme ne peut pas. Ici, sans sabotage de portes, le bouton est bloqué pendant **tout** sabotage.
- **Technique** : poste « Bouton d’urgence » à scanner sur place ; compteur par joueur ; délai ; blocages identiques.

### 11. Chronologie de la réunion — 🟡
- **Officiel** : téléportation de tous → discussion (15 s par défaut) → vote (120 s) → résultat → éjection.
- **Maison** : ajout d’une phase **rassemblement** (90 s, ou plus tôt quand tous les vivants ont touché « Je suis arrivé·e » ; dès que la majorité est arrivée, il ne reste que 15 s aux retardataires) car on ne se téléporte pas ; discussion 90 s, écourtée dès que la majorité des vivants a touché « Prêt à voter » ; vote 90 s ; résultat 12 s ; puis reprise automatique.

### 12. Vote — 🟡
- **Officiel** : chaque vivant vote pour un vivant ou « passer » ; vote définitif ; fin anticipée quand tous ont voté ; le plus de voix est éjecté ; **égalité, « passer » majoritaire, égalité avec « passer » ou aucun vote → personne** ; ne pas voter = abstention ; votes anonymes en option ; on voit qui a déjà voté.
- **Technique** : identique ; les votes individuels ne sont envoyés qu’au résultat et jamais en mode anonyme ; un vote pour un joueur parti entre-temps est ignoré.

### 13. Annonce après l’éjection — 🟡
- « X était / n’était pas un imposteur » + nombre d’imposteurs restants si **Confirmer les éjections** (activé par défaut) ; sinon « X a été éjecté ». Le rôle spécial n’est jamais annoncé.

### 14–15. Joueurs morts — ✅ / 🟡
- **Officiel** : fantômes invisibles des vivants, ne votent pas, ne signalent pas, ne réparent pas, ne parlent qu’entre fantômes ; l’équipage fantôme **doit finir ses tâches (elles comptent)** ✅ ; l’imposteur fantôme peut saboter mais ni éliminer ni utiliser les conduits.
- **Maison** : un fantôme porte un badge « FANTÔME », garde un silence total avec les vivants, assiste aux réunions sans parler.
- **Technique** : identique ; le fantôme d’équipage ne peut faire ses tâches qu’une fois son corps découvert (ou disparu).
- **Différence** : un fantôme est visible. Pour limiter l’information, il reste assis sur place tant que son corps n’est pas découvert ; ensuite les morts sont de toute façon annoncés en réunion.

### 16. Conditions de victoire — ✅ / 🟡
- Équipage : toutes les tâches de l’équipage (fantômes compris) **ou** plus aucun imposteur en jeu (éjection ou départ).
- Imposteurs : imposteurs vivants ≥ équipiers vivants (élimination, éjection ou départ) **ou** sabotage critique non réparé.
- Ordre d’évaluation retenu (⚠️ non documenté officiellement) : plus d’imposteurs → équipage ; sinon parité → imposteurs ; sinon tâches → équipage. Les conditions sont vérifiées immédiatement en jeu et à la fin de chaque réunion (après l’annonce du résultat).

### 17. Fin de partie — 🟡
- Écran victoire/défaite et révélation de tous les rôles → identique, avec en plus un récapitulatif (éliminations, réunions, votes, sabotages, tâches).

### 18. Options — 🟡 (valeurs par défaut officielles relevées)
Imposteurs 1–3 · délai d’élimination 10–60 s (45) · distance courte/moyenne/longue (moyenne) · réunions d’urgence 0–9 (1) · délai du bouton 0–60 s (15) · discussion 0–120 s (15) · vote 0–300 s (120) · votes anonymes (non) · confirmer les éjections (oui) · barre de tâches (toujours) · tâches communes 0–2 (1), longues 0–3 (1), courtes 0–5 (2) · tâches visuelles (oui) · vision/vitesse. *Vision, vitesse et distance n’ont pas d’équivalent dans une maison et ne sont pas reproduites.*

### 19. Informations accessibles — ✅ / 🟡
| Information | Équipage vivant | Imposteur vivant | Fantôme | MJ |
|---|---|---|---|---|
| Son rôle | oui | oui | oui | tous |
| Alliés imposteurs | non | oui | (imposteur) oui | tous |
| Morts non encore annoncés | non (sauf moniteur de vie) | non | oui | oui |
| Votes individuels | au résultat (si non anonymes) | idem | idem | en direct |
| Rôles des autres | non | non (sauf alliés) | non par défaut (option) | oui |
| Codes des postes | non | non | non | oui |

⚠️ Dans le jeu officiel, un fantôme peut découvrir les rôles grâce à « Hanter ». Dans une maison, un fantôme bavard ruinerait la partie : option désactivée par défaut.

### 20. Autres règles relevées
- Les imposteurs peuvent fermer des portes et emprunter les **bouches d’aération** (✅). → **Conduits** facultatifs : itinéraires sûrs réservés aux imposteurs, décrits par le MJ.
- **Tâches visuelles** (🟡) : certaines tâches sont visibles et innocentent. → Le « Scan médical » affiche un grand écran vert animé visible de loin, que le téléphone d’un imposteur n’affiche jamais.
- **Moniteur de vie** (🟡, cartes Polus/Airship/Fungle) → poste « Moniteur de vie ».
- Caméras, carte d’administration, journal des portes, vision : **non reproduits** (nécessiteraient vidéo ou localisation).
- Exclusion d’un joueur par vote de 3 joueurs (🟡) → remplacée par l’exclusion par le MJ.

## 4. Points incertains et choix assumés
1. **Ordre des conditions de victoire** quand plusieurs se réalisent ensemble : non documenté ; choix décrit au §16.
2. **Délai de sabotage après une réunion** : non documenté ; choix : au moins 10 s après la fin de la réunion.
3. **Majorité relative vs absolue** : une source parle de majorité absolue, les autres (plus détaillées et cohérentes avec le comportement observé) de majorité relative. Choix : majorité relative, l’égalité ou « passer » majoritaire empêchant l’éjection.
4. **Bouton d’urgence pendant « Communications »** : bloqué selon les sources les plus récentes (tous sabotages sauf portes) ; c’est ce qui est implémenté.
