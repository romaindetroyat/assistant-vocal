# Tâche rapide — Appui maintenu pour parler, autorisations demandées moins souvent

## Demande
« Il faudrait que je reste appuyé sur le bouton pour parler, la gestion du micro déconne encore. À chaque lancement je dois
redonner l'accès au micro et à la position : je veux que ce soit enregistré une bonne fois et fluide. »

## Fait
- **Appui maintenu** (réglage `parole`, défaut « maintenir », option « mains libres » dans Mes outils) : le micro n'écoute que
  pendant l'appui ; appuyer coupe la parole à l'assistant et vide le tampon, relâcher valide le tour (`input_audio_buffer.commit`)
  et la réponse part dès la transcription. Session Realtime sans détection de tour (`turn_detection: null`). Appui < 0,3 s
  ignoré. Le premier appui ouvre la conversation (« Connexion… », l'écoute commence dès qu'elle est prête). Gros bouton du mode
  voiture et micro de l'interface : « Maintenez pour parler » → « Parlez… » → « Je réfléchis… » → « Je réponds… ».
  Sans voix configurée : dictée maintenue, envoyée au relâchement.
- **Position** : gardée 3 h dans le stockage local (survit à la fermeture de l'app) ; redemandée au navigateur seulement si
  l'autorisation est déjà accordée ou si la question en a besoin (trajet, « ici », « près de », météo sans lieu…).
- **Micro** : demandé au premier appui seulement (plus à l'ouverture). Limite iOS : l'app de l'écran d'accueil oublie les
  autorisations à chaque lancement ; un web app ne peut pas l'empêcher (voir réponse à Romain).
- Tests : appui maintenu (micro muet hors appui, commit, réponse immédiate, appui trop court), session sans détection de tour.
  116 verts. Cache SW v44.
