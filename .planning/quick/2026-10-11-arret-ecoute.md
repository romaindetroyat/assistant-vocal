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
