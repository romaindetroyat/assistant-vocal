# Phase 23 — Résumé

## Livré
- **Interface Ardoise** : rail sombre (Parler, Organiser, Coffre, Réglages, Voiture ambré), scène centrale avec gros micro,
  puces de demandes fréquentes et saisie, dock modèle + longueur avec estimation, panneau Transcription sombre à droite.
  Sous 820 px : transcription en haut, scène compacte, rail en barre du bas. Thème clair et sombre (Sora + Manrope).
- **Micro unifié** : toucher = dictée jusqu'au silence (vocal transcrit si la dictée manque), maintenir 0,6 s puis relâcher =
  conversation en direct (l'appel part au relâchement, geste exigé par Safari), toucher pendant l'appel = raccrocher.
  Espace maintenue et Ctrl+Espace inchangés.
- **Boutons retirés** : lecture à voix haute, réécoute locale, vocal séparé, appel séparé ; notifications et raccourcis
  rangés dans Historique ; état des outils dans Réglages.
- **Modèle au choix** (`modele` : haiku / sonnet / opus) avec rôle, délai et coût indicatifs ; Haiku sans `fallbacks` et
  avec `web_search_20250305`. **Cinq longueurs** (très court → très développé) : consigne système pour le chat texte,
  instructions de la voix ; la voiture reste en très court.
- **Mode voiture** restylé : puce « modèle · très court », dernière question et réponse en grand, onde animée,
  gros bouton ambré + « Fin » pendant l'appel, rappel de la coupure après une minute de silence.

## Tests
101 tests verts (`test/reglages.test.js` : niveaux, validation, modèle et forme de requête Haiku/Opus, consigne de longueur ;
`trajets.test.js` adapté : la consigne de position s'ajoute à celle de longueur).
Rendu Playwright (bureau clair/sombre, mobile, voiture) sans erreur JS.

## Écarts
- Les délais et coûts affichés sont des ordres de grandeur mesurés (≈ 2 / 4 / 7 s ; 0,05 / 0,5 / 1 ct) ; « + » quand la longueur est développée.
- Pas d'horodatage par message (non stocké) : étiquettes « Vous » / « A. » dans la transcription.
