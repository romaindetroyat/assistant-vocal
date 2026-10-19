# Tâche rapide — Réduire nettement la consommation Claude

## Constat (suivi interne /api/usage, lecture seule)
- Total suivi : ≈ 10 $ du 10 au 19 octobre ; les 10-11/10 (≈ 5,3 $) correspondent surtout à mes tests en production
  (diagnostic de latence, essais vocaux) ; depuis le 13/10 : 0,38 à 0,84 $ par jour.
- Aujourd'hui, ≈ 80 % du coût quotidien vient des tâches de fond sur Opus (brief, départs, rendez-vous, résumé du soir :
  ~6 appels/jour) et surtout de leurs écritures de cache 1 h (2 × le prix d'entrée) jamais relues.
- Les usages de l'utilisateur (chat, voix) sont désormais faibles et majoritairement sur Haiku (mode auto).

## Fait
- Tâches de fond hors Opus : brief et résumé du soir sur Sonnet, extraction des rendez-vous et des départs sur Haiku ;
  compaction, consolidation de la mémoire et lecture des documents du coffre sur Sonnet. Le réglage du curseur ne s'applique
  plus aux tâches de fond.
- Cache court (5 min, 1,25 ×) pour ces tâches ponctuelles au lieu du cache 1 h (2 ×).
- Test : modèles et cache des tâches de fond. 117 verts. Cache SW v45.

## Estimation
Tâches de fond : ≈ 0,35 $/jour → ≈ 0,10 $/jour. À vérifier dans /api/usage d'ici 2-3 jours.

## Hors de portée de l'app
- Le suivi interne ne voit ni les appels faits avec une autre clé (assistant-vocal2 ?), ni la voix (OpenAI, facturée à part),
  ni l'action GitHub Claude Code (une seule exécution, le 10/10). Les écritures concurrentes en KV peuvent sous-compter.
