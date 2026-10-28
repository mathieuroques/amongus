# Alertes, sons et notifications

## Comment les joueurs sont prévenus
Le serveur envoie l’état de la partie en direct à chaque téléphone. Quand un événement important survient, l’application réagit à trois niveaux :

| Situation du téléphone | Ce qui se passe |
|---|---|
| **Application ouverte, écran allumé** | Écran d’alerte plein écran (rouge pour une réunion ou un sabotage critique), **son** distinct par événement, **vibration** (Android). Pendant un sabotage critique, une courte sirène se répète toutes les 7 s. |
| **Application en arrière-plan ou écran verrouillé** (notifications activées) | **Notification push** du système, avec vibration et son du téléphone. En la touchant, on revient dans le jeu. |
| **Notifications non activées, écran éteint** | Rien ne sonne. Au réveil du téléphone, l’application se reconnecte en quelques secondes et affiche l’état à jour (réunion en cours, etc.). |

Événements concernés : début de la partie, réunion (corps signalé ou bouton d’urgence), sabotage critique (réacteur, oxygène), arrêt d’urgence et reprise, fin de partie, « test d’alerte » du MJ. Les autres sabotages provoquent seulement un son court. Le maître du jeu reçoit en plus les **alertes sécurité** des joueurs.

Les notifications ne contiennent **que des informations publiques** (« Réunion : rejoignez le Salon »), jamais un rôle, une victime ou un nom d’imposteur, car elles peuvent s’afficher sur l’écran verrouillé.

## Ce que permet chaque téléphone (octobre 2026)
| | Android (Chrome, Edge, Firefox…) | iPhone / iPad (Safari) |
|---|---|---|
| Son dans l’application | oui | oui (désactivez le **mode silencieux** : sur les versions récentes de Safari, l’application demande à jouer le son malgré lui, mais ce n’est pas garanti) |
| Vibration | oui | **non** (iOS ne permet pas aux sites web de faire vibrer) |
| Notifications écran verrouillé | oui, depuis le navigateur | **seulement si l’application est ajoutée à l’écran d’accueil** (Partager → « Sur l’écran d’accueil ») puis ouverte depuis l’icône (iOS 16.4 et plus) |
| Garder l’écran allumé | oui | oui (Safari récent) |
| Serveur local `http://` (option sans compte) | pas de notifications, pas de caméra | idem |

Fonctionnement technique : notifications *Web Push* standard (RFC 8030), signées avec une clé VAPID générée automatiquement pour chaque partie et chiffrées de bout en bout (RFC 8291). Elles transitent par le service de notification du fabricant du téléphone (Google, Apple, Mozilla, Microsoft), gratuitement, sans compte ni clé à configurer. Seuls ces services sont contactés par le serveur. Une notification n’est envoyée qu’aux téléphones dont l’application n’est pas au premier plan (au plus 45 par événement, limite de l’offre gratuite de Cloudflare).

## Recommandations pour une bonne soirée
1. **Le maître du jeu annonce les réunions à voix haute** (« RÉUNION ! »), en plus des téléphones. C’est le moyen le plus fiable : aucune technologie ne garantit qu’un téléphone au fond d’une poche sonnera.
2. **Au salon, chaque joueur règle ses alertes** (carte « Alertes de ce téléphone ») : tester le son, activer les notifications, cocher « Garder l’écran allumé ». Les iPhone doivent d’abord ajouter le jeu à l’écran d’accueil.
3. **Le MJ fait sonner tous les téléphones** (onglet Partie ou Tests) avant le démarrage et demande à chacun de lever la main : ceux qui ne sonnent pas règlent leurs alertes.
4. Volume au maximum, mode silencieux et « Ne pas déranger » désactivés pour la soirée.
5. Le téléphone se porte **en main ou en poche, écran allumé** si possible, mais on ne le regarde jamais en marchant dans un escalier : l’écran d’alerte et le son suffisent pour savoir qu’il faut aller en réunion.
6. Prévoir quelques **batteries externes** : l’écran allumé consomme beaucoup.
7. Pendant une réunion, le compte à rebours de rassemblement laisse le temps d’arriver à ceux qui n’ont rien entendu ; une fois la majorité arrivée, il ne reste que 15 s : le MJ peut le prolonger (+30 s) s’il voit qu’un joueur arrive.
8. **Téléphone sorti de veille** : une action faite pendant la reconnexion n’est pas perdue ; un bandeau jaune « Reconnexion… » s’affiche et l’action part dès le retour de la connexion (jusqu’à 5 s). Au-delà, elle est refusée avec un message clair et n’est jamais envoyée plus tard : réessayez.
9. **Vibrations discrètes** (Android) : la victime d’une élimination sent son téléphone vibrer (aucun son, pour ne pas alerter les témoins) ; un imposteur sent une courte vibration quand il peut de nouveau éliminer ou saboter.
