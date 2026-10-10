# Summary 21-01 (tâche A) — Extension Chromium, CORS serveur, guide « Mes outils »
**Status**: Complete (tâche A + partie C : test CORS, manifeste, zip) · **Requirements**: EXT-01, EXT-02 · **Date**: 2026-10-10
## What was built
- `extension/` (Manifest V3, non empaquetée, pas de Web Store) : `manifest.json` (nom « Assistant vocal », 1.0.0,
  `action` popup, `background.service_worker: background.js` type module, permissions `contextMenus storage tabs
  scripting windows notifications`, `host_permissions` sur la production, `optional_host_permissions` pour un autre
  hôte, trois `commands` : `parler` Ctrl+Maj+Espace « Ouvrir l'assistant et parler », `envoyer-page` Ctrl+Maj+E,
  `ouvrir` Ctrl+Maj+A, variantes `MacCtrl`, `options_page`), icônes PNG 16/48/128.
- `background.js` : fenêtre dédiée (`chrome.windows.create` popup 440×820) mémorisée dans `chrome.storage.session`,
  vérifiée par `chrome.windows.get` et réutilisée (`windows.update focused`) ; `tabs.update` seulement pour
  `?action=appel` et `?conversation=`. Menus contextuels « Envoyer la sélection / ce lien / cette page à l'assistant ».
  Envoi = `POST <hote>/api/partage` JSON `{ texte, url, consigne }` avec `Authorization: Bearer <jeton>` ; texte de
  page extrait par `chrome.scripting.executeScript` (titre + `document.body.innerText`, 20 000 caractères) ; consigne
  demandée par `window.prompt` dans l'onglet (annulé = envoi abandonné, impossible = vide) ; notification
  « Assistant » (300 caractères) dont le clic ouvre `/app?conversation=<id>` dans la fenêtre dédiée. Jeton absent →
  notification + page d'options ; 401 → « Jeton refusé » ; réseau → « Assistant injoignable ». Popup (`popup.html/js`)
  : Parler, Ouvrir l'assistant, Envoyer la page, via `runtime.sendMessage`. `reglages.js` partagé (hôte normalisé
  https, jeton dans `chrome.storage.sync`). `options.html/js` : hôte (vide = production, autre hôte →
  `chrome.permissions.request`, refus toléré grâce au CORS), jeton (masqué, bouton Afficher), bouton Tester (`POST
  /api/raccourci` « Dis bonjour en trois mots »), rappel des raccourcis et de `chrome://extensions/shortcuts` à copier.
  `README.md` : installation en cinq étapes, gestes, raccourcis, options, limites, développement.
- `scripts/extension-icons.mjs` : PNG RGBA (disque bleu, micro blanc) encodés à la main avec `node:zlib` et CRC-32,
  sans dépendance (`npm run extension:icons`). `scripts/extension-zip.mjs` : zip « stored » minimal (entêtes locaux,
  répertoire central, CRC-32, noms UTF-8) → `dist/assistant-extension.zip` (`npm run extension:zip`, `dist/` ignoré) ;
  exporte `creerZip`, `listerZip`, `zipExtension` pour les tests ; vérifié avec `unzip -t`.
- `server/app.js` : CORS restreint aux origines `^(chrome|moz)-extension://<id>$` sur `/api/partage` et
  `/api/raccourci` uniquement : `app.options` → 204 avec `Access-Control-Allow-Origin: <origine>`, `Vary: Origin`,
  `Allow-Headers: Authorization, Content-Type`, `Allow-Methods: POST, OPTIONS`, `Max-Age` ; middleware ajoutant les
  mêmes en-têtes aux réponses POST (y compris 401, pour que l'extension lise l'erreur). Enregistré avant le middleware
  d'authentification `/api/*` pour que le préflight ne soit pas bloqué. Aucune autre origine ni route.
- `public/outils.html` : sous-section « Extension Chromium » en fin d'« Appareils et raccourcis » (deux cartes
  `.raccourci` : installation + jeton injecté via `.jeton-exemple` / `.hote-raccourci`, raccourcis et menu contextuel
  avec `.url-app[data-suffixe="?action=appel"]`, page `chrome://extensions/shortcuts`). Le zip n'est pas servi par
  le site : le guide renvoie au dossier `extension/` du dépôt GitHub romaindetroyat/assistant-vocal.
## Verification
`test/extension.test.js` (5 tests) : préflight 204 avec en-têtes pour `chrome-extension://` et `moz-extension://`,
rien pour `https://autre.site`, origine mal formée ou route à session ; POST `/api/partage` et `/api/raccourci` avec
jeton + Origin renvoient l'en-tête (401 aussi), rien sans Origin ; manifeste MV3 (trois commandes et touches, permissions,
fichiers référencés présents, PNG aux bonnes dimensions) ; `node --check` des scripts via `execFileSync`, pas de
`strict: true`, hôte par défaut = production, `inline-assets.mjs` limité à `public/` ; zip (signature, `manifest.json`
à la racine, CRC-32 de « 123456789 »). `npm test` : 91 tests verts (86 + 5). `node --check extension/*.js` OK.
`CACHE` de `public/sw.js` non incrémenté (fait à la fusion avec la tâche B).
## Limits
- Pas de Safari ni d'iPhone/iPad ; Firefox non testé (le serveur accepte `moz-extension://` mais le manifeste utilise
  `background.service_worker`, à adapter en `scripts` pour Firefox).
- Non signée : Chrome affiche au démarrage le bandeau « Désactiver les extensions en mode développeur » ; mise à jour
  manuelle (Recharger dans `chrome://extensions`).
- Le texte des pages internes (`chrome://`, Web Store, visionneuse PDF, pages bloquant les scripts) n'est pas
  extractible : seuls titre et URL sont envoyés, sans consigne (`window.prompt` impossible).
- `Ctrl+Maj+Espace` n'est appliqué que s'il est libre ; sinon à régler dans `chrome://extensions/shortcuts` (seul
  endroit pour le rendre global). Chrome limite à quatre les raccourcis suggérés : trois utilisés.
- Avec un hôte autre que la production, le micro de la fenêtre dédiée et le CORS fonctionnent mais la permission de
  site est demandée ; le `?action=appel` exige encore un clic si le navigateur bloque l'autoplay du micro (tâche B).
- La notification tronque la réponse à 300 caractères ; la fenêtre dédiée est perdue au redémarrage de Chrome
  (`storage.session`), une nouvelle est créée. Le jeton est en clair dans `chrome.storage.sync` (profil Chrome).
- `/extension.zip` n'est pas servi par le Worker (le dossier n'est pas embarqué) ; distribution par le dépôt ou le zip
  local.
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
