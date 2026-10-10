# Summary 08-01 — Gmail en direct
**Status**: Complete · **Requirements**: INT-01, OUT-02 · **Date**: 2026-10-10
## What was built
- `server/google.js` : OAuth Google (gmail.modify), plusieurs comptes, rafraîchissement, résolution « perso / altapyx / takeoff », signatures par compte
- `server/gmail.js` : gmail_comptes / rechercher / lire (texte ou HTML nettoyé) / envoyer / repondre (fil, In-Reply-To) / brouillon / signature ; MIME UTF-8 ; signature ajoutée sans doublon
- Identifiants OAuth saisis dans l'application (KV) ou par variables ; section Gmail dans « Mes outils »
## Verification
gmail.test.js ; recherche réelle sur les 3 comptes via l'assistant. Décision : l'API Gmail directe plutôt que le « Gmail MCP API » de Google (aperçu, sans envoi).
