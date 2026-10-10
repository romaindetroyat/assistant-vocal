# Extension Chromium « Assistant vocal »

Extension Manifest V3 pour Chrome, Chromium, Edge, Brave, Arc et Vivaldi. Elle ne contient pas l'assistant : elle ouvre
l'application web dans une fenêtre dédiée (cookies et micro restent first-party) et envoie des contenus à `/api/partage`
avec un jeton d'appareil. Pas de version Web Store : chargement « non empaquetée » depuis ce dossier, ou depuis le zip.

## Installation en cinq étapes

1. Récupérez le dossier `extension/` du dépôt (clone Git, ou `npm run extension:zip` qui produit
   `dist/assistant-extension.zip` à décompresser).
2. Ouvrez `chrome://extensions` (Edge : `edge://extensions`, Brave : `brave://extensions`) et activez le
   **Mode développeur** (interrupteur en haut à droite).
3. Cliquez **Charger l'extension non empaquetée** et choisissez le dossier `extension/` (celui qui contient
   `manifest.json`). L'icône bleue apparaît dans la barre d'outils (épinglez-la via le menu des extensions).
4. Dans l'assistant, **Mes outils › Appareils et raccourcis › Nouvel appareil** (nom « Chrome »), copiez le jeton.
5. Clic droit sur l'icône → **Options** : collez le jeton, **Enregistrer**, puis **Tester**. La réponse « Bonjour… »
   confirme que tout fonctionne.

Le jeton est stocké dans `chrome.storage.sync` (profil Chrome). Révoquez-le depuis Mes outils si le poste est perdu.

## Ce que fait l'extension

| Geste | Effet |
| --- | --- |
| `Ctrl`+`Maj`+`Espace` (Mac : `Ctrl`+`Maj`+`Espace`) | Ouvre la fenêtre de l'assistant sur `/app?action=appel` et lance la conversation vocale (un clic reste nécessaire si le navigateur exige un geste pour le micro) |
| `Ctrl`+`Maj`+`A` | Ouvre (ou ramène au premier plan) la fenêtre de l'assistant sans changer la conversation |
| `Ctrl`+`Maj`+`E` | Envoie la page courante (titre + texte, 20 000 caractères maximum) à l'assistant ; une fenêtre « Que faire ? » permet une consigne (vide = l'assistant choisit) |
| Clic droit → **Envoyer la sélection / ce lien / cette page à l'assistant** | Même envoi, à partir du texte sélectionné, du lien ou de la page |
| Icône de l'extension | Popup : Parler, Ouvrir l'assistant, Envoyer la page |

La réponse arrive en notification système (300 caractères) ; cliquer dessus ouvre la conversation « Partages ».

## Raccourcis clavier

Chrome n'applique les raccourcis suggérés que s'ils sont libres. Pour les changer, les rendre **globaux** (actifs même
quand Chrome n'est pas au premier plan) ou vérifier qu'ils sont actifs : tapez `chrome://extensions/shortcuts` dans la
barre d'adresse, repérez « Assistant vocal » et choisissez la combinaison, puis « Dans Chrome » ou « Global ».

## Options

- **Adresse de l'assistant** : vide = production (`https://assistant-vocal.romaindetroyat.workers.dev`). Une autre
  adresse (instance locale, autre déploiement) déclenche une demande d'accès au site (`chrome.permissions.request`) ;
  si elle est refusée, les appels passent par le CORS du serveur (origines `chrome-extension://` autorisées sur
  `/api/partage` et `/api/raccourci`), seul le raccourci « Parler » peut alors ouvrir la fenêtre sans permission.
- **Jeton d'appareil** : obligatoire pour envoyer des contenus. Sans jeton, l'extension ouvre les options.

## Limites

- Chromium uniquement : pas de Safari ni d'iPhone/iPad (utilisez les raccourcis iOS décrits dans Mes outils). Firefox
  n'est pas testé (`moz-extension://` est accepté par le serveur mais le manifeste utilise `service_worker`).
- L'extraction du texte est impossible sur les pages internes (`chrome://`, Web Store, visionneuse PDF) : seul le
  titre et l'URL sont envoyés, sans consigne.
- La notification affiche le début de la réponse ; le détail est dans la conversation « Partages » de l'app.
- Extension non signée : Chrome affiche un bandeau « Désactiver les extensions en mode développeur » au démarrage.

## Développement

- `node scripts/extension-icons.mjs` régénère les icônes PNG (16/48/128) sans dépendance.
- `npm run extension:zip` crée `dist/assistant-extension.zip` (format zip « stored », sans dépendance).
- `test/extension.test.js` vérifie le manifeste, la syntaxe des scripts, le CORS serveur et le zip.
- Après modification, cliquez **Recharger** sur la carte de l'extension dans `chrome://extensions`.
