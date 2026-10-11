# Tâche rapide — Pouvoir arrêter l'écoute (extension Chromium)

## Demande
« Dans le plugin chromium, le micro reste ouvert en permanence, je ne veux pas ça, je veux pouvoir stopper l'écoute. »

## Causes
- Le bruit ambiant (détections de parole sans texte valable) réarmait le minuteur d'inactivité : l'appel ne se terminait jamais seul.
- « Raccrocher » / Échap / Ctrl+Espace terminaient l'appel mais gardaient le micro partagé ouvert une minute, et relançaient la veille si « mains libres » était actif.
- Le raccourci « Parler » de l'extension rechargeait la page au lieu d'agir comme un interrupteur.

## Fait
- `public/conversation.js` : seules une transcription valide ou une réponse de l'assistant prolongent l'appel.
- `public/app.js` : `arreterEcoute()` pour tout arrêt volontaire (bouton « Arrêter l'écoute », Échap, Ctrl+Espace, micro, voiture) : fin d'appel, pas de veille, micro éteint aussitôt. `window.__assistantBasculerEcoute` exposé pour l'extension.
- `extension/background.js` (v1.1.0) : « Parler » dans la fenêtre déjà ouverte bascule l'écoute (script dans le monde de la page), repli sur la navigation.
- Test : le bruit n'empêche plus la fin automatique. Cache SW v37.

## Suite — « Le micro est toujours ouvert »
- Fuite 1 : arrêt pendant l'ouverture du micro (permission en cours ou connexion à la voix) → le micro s'ouvrait ensuite et
  n'était plus jamais fermé (conversation.js ouvrait même son propre flux après le raccrochage). Corrigé : demande de micro
  unique, numéro de génération (micro accordé après un arrêt = éteint aussitôt), registre de tous les flux éteints par
  `fermerMicro`, vérifications `actif` après chaque attente de `connecter()`.
- Fuite 2 : dictée lancée sans parler → le navigateur relançait l'écoute indéfiniment. Arrêt après 15 s sans parole.
- Journal client : « micro ouvert / éteint (n pistes) », envoyé dès l'arrêt de l'écoute. Cache SW v38.
