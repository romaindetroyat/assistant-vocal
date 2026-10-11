# Summary 22-01 — Coffre de documents chiffré
**Status**: Complete · **Requirements**: DOC-01, DOC-02, DOC-03, DOC-04 · **Date**: 2026-10-11
## What was built
- `server/chiffrement.js` : AES-256-GCM (WebCrypto), clé `DOCS_KEY` ou dérivée de `SESSION_SECRET` (HKDF-SHA256),
  IV aléatoire par chiffrement, format blob IV + chiffré, variantes texte pour les champs sensibles.
- `server/blobs.js` : façade binaire R2 (binding `DOCS`) / KV (`blob:<id>`) / fichiers (Node, tests).
- `server/documents.js` : ajout (validation JPEG/PNG/WebP/PDF ≤ 20 Mo, HEIC refusé), extraction de la fiche par
  Claude (bloc image ou document, effort low, JSON validé, repli fiche minimale), champs sensibles chiffrés, index
  `docs:index`, recherche pondérée (titre, personne, mots-clés, organisme, champs, résumé), lecture masquée / révélée,
  correction et validation, suppression (fiche + blob), expirations ; outils `document_chercher`, `document_lire`
  (confirmation obligatoire pour les champs sensibles), `document_expirations` ; usage journalisé (source documents).
- Routes : `POST /api/documents` (cookie ou jeton d'appareil), `GET /api/documents`, `GET/PUT/DELETE
  /api/documents/:id`, `GET /api/documents/:id/fichier` (original déchiffré, cookie seulement), page `/documents`.
- Partage : consigne « coffre / classe / range / archive » → le fichier (image ou PDF) part au coffre, espace déduit
  de « pro / client / perso ».
- Prompt (section coffre : discrétion, confirmation, jamais en conduisant), brief (documents à renouveler sous 60 j).
- Front : `public/documents.html` (ajout, filtres perso/pro, recherche, fiche éditable, champs 🔒, original,
  suppression), bouton 🗂️ « Ranger dans le coffre » sur les images jointes, lien dans le tiroir.
## Verification
`test/chiffrement.test.js`, `test/documents.test.js` (98 tests au total, verts).
## Limits
- R2 non activé sur le compte : fichiers dans KV en attendant (25 Mo par valeur, quota KV) ; décommenter le binding
  `DOCS` dans `wrangler.jsonc` une fois le bucket créé (aucune migration automatique des fichiers déjà en KV).
- Fiches (hors champs sensibles) en clair dans le KV, comme la mémoire et les tâches.
- Clé dérivée de `SESSION_SECRET` : changer ce secret rend les documents illisibles ; définir `DOCS_KEY` dédiée est
  recommandé avant d'y mettre beaucoup de documents.
- Recherche par mots-clés (pas sémantique) ; pas d'OCR hors Claude ; PDF > 100 pages refusés par l'API.
