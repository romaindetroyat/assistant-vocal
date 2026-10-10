# Summary 21-01-B — App : raccourcis clavier, micro conservé, position en cache, section « Autorisations »
**Status**: Complete (tâche B du plan 21-01 ; la tâche A — extension, CORS, guide — est livrée séparément) ·
**Requirements**: EXT-03, EXT-04 · **Date**: 2026-10-10
## What was built
- **Micro partagé** (`public/app.js`, bloc `// ---------- Micro partagé (phase 21) ----------`) : un seul
  `MediaStream` (`micro.flux`) obtenu par `obtenirMicro()` au premier besoin (contraintes `echoCancellation`,
  `noiseSuppression`, `autoGainControl`) et réutilisé par le vocal enregistré (`demarrerEnregistrement` : MediaRecorder
  sur le flux partagé, plus d'arrêt des pistes à la fin), par la conversation en direct (`demarrerAppel` demande le
  micro pendant le geste puis le passe via `appel.demarrer(id, { flux })` ; `conserverFlux` renvoie toujours `true`
  et `surFin` récupère le flux avec `appel.recupererFlux()`) et par la veille mains libres (`lancerEcouteLocale` :
  `veille.flux = await obtenirMicro()`). `arreterVeille()` ne ferme plus rien (le paramètre `garderFlux` a disparu),
  elle relâche seulement sa référence. Fermeture (`fermerMicro`) uniquement quand l'onglet reste caché plus de
  2 minutes (minuteur armé sur `visibilitychange`, sauf appel ou enregistrement en cours) et à la déconnexion. Une piste
  terminée par le navigateur (`ended`) invalide le flux, qui sera redemandé au prochain besoin. La dictée
  (SpeechRecognition) garde son propre micro, rien ne lui est passé.
- **Position** : cache de 60 minutes (`POSITION_CACHE_MS`), `getCurrentPosition` avec `maximumAge: 3 600 000`,
  `timeout: 8 000`, `enableHighAccuracy: false`.
- **Raccourcis clavier** (`public/app.js`, bloc `// ---------- Raccourcis clavier ----------`) : hors champ de saisie
  (`input`, `textarea`, `select`, `contenteditable`) **Espace maintenue** = parler (dictée en mode maintien au
  `keydown` non répété si aucune dictée, aucun vocal ni appel en cours ; arrêt et envoi au `keyup` ; si le navigateur
  n'a pas de dictée mais que la transcription est configurée, c'est le vocal enregistré qui est utilisé ; si un appel est
  actif, Espace ne fait rien), **Ctrl+K** = focus sur le champ, **?** = aide-mémoire. Partout : **Ctrl+Espace** (ou
  ⌘+Espace, `e.ctrlKey || e.metaKey`) = lancer / raccrocher la conversation vocale, **Échap** = fermer l'aide, l'écran
  « Appuyez pour parler », raccrocher, quitter la veille, arrêter la dictée (sans envoyer) ou fermer le tiroir, dans cet
  ordre de priorité. Perte du focus de la fenêtre pendant l'appui : arrêt sans envoi, le texte reste dans le champ.
  Rien n'est actif sur l'écran de connexion.
- **Aide-mémoire** `#aide-raccourcis` dans `public/index.html` (dialogue en surimpression, liste `<kbd>`, fermé par Échap,
  le bouton ✕ ou un clic hors de la carte) ; bouton « ⌨️ Raccourcis clavier » dans le pied du tiroir ; styles
  `.aide-raccourcis`, `.aide-carte`, `.aide-liste`, `kbd` dans `public/styles.css`.
- **Section « Autorisations »** dans `public/outils.html` (nouvelle `<section>` juste avant « Réglages de la voix ») :
  trois lignes Micro / Position / Notifications avec badge « Accordée / À demander / Refusée / Inconnue, testez »
  (`navigator.permissions.query({ name })` en try/catch ; pour les notifications, `Notification.permission` sert de
  repli), bouton « Demander maintenant » (micro : `getUserMedia` puis arrêt immédiat des pistes ; position :
  `getCurrentPosition` ; notifications : `Notification.requestPermission()`), et sous chaque ligne non accordée la
  marche à suivre — Chrome (cadenas → Autorisations du site → Micro / Localisation / Notifications : Autoriser) ou iPhone
  (Réglages → Apps → Safari → Micro / Position → ce site → Autoriser ; app installée : Réglages → Safari → Position),
  selon `/iP(hone|ad)/` dans l'agent utilisateur. L'état est relu après chaque demande et via `permissionStatus.onchange`.
## Verification
- `node --check public/app.js` ✓ ; script inline de `outils.html` extrait et vérifié par `node --check` ✓.
- `npm test` : 86 tests verts (aucune modification serveur dans cette tâche, pas de nouveau test).
- Non vérifié ici (navigateur réel nécessaire) : comportement de l'appui maintenu, conservation du micro entre deux
  appels, badges d'autorisation sur Chrome et iPhone. `CACHE` de `public/sw.js` volontairement non incrémenté (fait à
  la fusion).
## Limits
- **⌘+Espace sur Mac** est capturé par Spotlight avant d'atteindre la page : utiliser Ctrl+Espace (fonctionne aussi
  sur Mac) ; l'aide-mémoire le précise.
- **Espace maintenue** n'agit que si le focus est hors d'un champ de texte (sinon elle tape une espace) ; quand elle
  agit, elle empêche le défilement de la page et l'activation du bouton qui aurait le focus. Elle ne fait rien pendant
  un appel. Ctrl+K hors champ peut être intercepté par certains navigateurs (barre de recherche) : l'app le prend quand
  l'événement lui parvient.
- **Micro conservé** = indicateur d'enregistrement du navigateur (point rouge dans l'onglet, pastille orange sur iOS)
  visible tant que l'app est au premier plan, même sans appel ; c'est le prix d'une ouverture immédiate. Sur iPhone,
  iOS peut couper le flux en arrière-plan avant les 2 minutes : la piste passe alors en `ended` et le micro est
  redemandé au prochain geste (sans nouvelle question si l'autorisation du site est mémorisée).
- La dictée (SpeechRecognition) ouvre son propre micro en parallèle du flux conservé : fonctionne sur Chrome ; sur
  Safari iOS, où la dictée est déjà peu fiable, préférer le vocal et la conversation en direct.
- `navigator.permissions.query({ name: 'microphone' })` est inconnu de Safari : le badge affiche « Inconnue, testez »
  jusqu'à un clic sur « Demander maintenant ». Les autorisations de l'app installée sur l'écran d'accueil iOS sont
  distinctes de celles de Safari : la page doit être consultée depuis l'app installée pour refléter son état.
- Position : avec `maximumAge` d'une heure, un déplacement dans l'heure peut utiliser une position périmée ; le
  serveur ne reçoit que lat/lng/précision, pas l'horodatage.
