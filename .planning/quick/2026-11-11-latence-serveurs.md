# Tâche rapide — « L'outil est beaucoup trop lent »

## Mesure (route /api/diag/latence en production, aucune donnée écrite)
| Variante | Premier événement | Total |
|---|---|---|
| sans outils | 0,7 s | 1,1 s |
| outils locaux seuls | 0,8 s | 1,3 s |
| + agenda (MCP) | 4,0 s | 4,4 s |
| + tous les serveurs MCP | 10,8 s | 13,0 s |
Journal client du 19/10 : 28 s entre la fin de la question et la fin de la réponse vocale.

## Cause
L'agenda (et tout serveur déjà activé dans la conversation, définitivement) était attaché à chaque appel au modèle :
≈ 3 s par serveur et par étape, payées même pour la météo ou une question générale, et plusieurs fois par réponse
(une étape par appel d'outil).

## Fait
- `routage.js` : `serveursPourDemande` n'attache que les serveurs que la demande évoque (agenda : rendez-vous, réunion,
  disponibilités… ; rugby → ovalie ; réunions passées → granola ; Element/Take Off → matrix ; dictaphone ; serveur nommé).
- `chat.js` : aucun serveur attaché par défaut, activation par `activer_serveur` valable pour le tour seulement (plus de
  serveurs gardés pour toute la conversation) ; les tâches de fond attachent l'agenda d'office.
- `prompt.js` : la liste des serveurs attachés passe dans le bloc volatil : le bloc stable (en cache) ne change plus.
- Test du chat réécrit (aucun serveur pour rien, activation le temps du tour, agenda attaché sur une demande d'agenda).
  117 verts. Cache SW v46.
