# Summary 14-01 — Mémoire consolidée
**Status**: Complete · **Requirements**: PER-04 · **Date**: 2026-10-10
## What was built
- `server/memoire-consolidation.js` : `consoliderMemoire` (dès 8 entrées, Claude `config.model`, `thinking: adaptive`, effort `low`, 4000 tokens, sans outil ni prefill) renvoie une mémoire fusionnée en JSON strict `[{categorie, cle, texte}]` plafonnée à 60 ; parse tolérant (bloc ```json), validation stricte (catégories, textes non vides, liste non vide) ; `id`, `creeLe`, `vu` préservés par clé stable puis par texte ; JSON invalide ou erreur d'appel → mémoire intacte + journal d'échec. Journal `memoire-journal` (20 dernières : date, avant, apres, fusionnees, supprimees, resume ≤ 10 lignes, ok). `consolidationHebdo` : garde KV `memoire-consolidation` (> 7 jours, heure Paris ≥ 6 h). `lireJournalMemoire`.
- Branchement : `demarrerPlanificateur(intervalle, { client })` (client fourni par `index.js`) et cron `scheduled` de `worker.js` (client construit comme pour l'application, ignoré sans `ANTHROPIC_API_KEY`).
- Routes : `POST /api/memoire/consolider` (renvoie l'entrée de journal, `null` si < 8 entrées) et `GET /api/memoire/journal`.
- Front `outils.html` : bouton « Consolider maintenant », bloc « Journal des consolidations » (date, avant → après, résumé) ; `sw.js` CACHE v14 → v15.
## Decisions
- Appariement par clé stable d'abord, puis par texte : une clé conservée garde son `id` même si le texte est reformulé.
- Une proposition vide est refusée : la consolidation ne peut jamais effacer toute la mémoire.
- Pas de nouvel outil Claude (traitement de fond) ; pas de `strict: true` ajouté.
## Verification
`test/memoire-consolidation.test.js` (6 tests, client Anthropic simulé, aucun réseau) : fusion effective + ids préservés + forme de la requête, JSON invalide / catégorie inconnue / texte vide / panne → mémoire intacte et journal d'échec, seuil de 8, plafond 60, garde hebdomadaire (heure Paris, 7 jours), routes (200 avec session, 401 sans). `npm test` : 45 tests verts.
