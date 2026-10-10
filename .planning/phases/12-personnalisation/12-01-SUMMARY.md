# Summary 12-01 — Personnalisation
**Status**: Complete · **Requirements**: PER-01, PER-02, PER-03 · **Date**: 2026-10-10
## What was built
- `server/consignes.js` : consignes durables (réglage + outils retenir / oublier), injectées en priorité
- `server/memoire.js` : faits par catégorie (préférence, personne, projet, habitude, fait), mise à jour par clé, bloc profil dans le prompt, outils memoire_noter / chercher / oublier, vue et effacement dans « Mes outils »
- `server/taches.js` : tâches (échéance, heure, priorité, projet, notes), tri, filtres, rappel 15 min avant lié, page `/taches`, point du matin (push 8 h, une fois par jour)
- `tools.js` : limite de 20 outils stricts → mode strict réservé à 6 outils
## Verification
memoire-taches.test.js, consignes.test.js ; test réel : une phrase → tâche datée priorité haute + rappel, deux souvenirs notés.
