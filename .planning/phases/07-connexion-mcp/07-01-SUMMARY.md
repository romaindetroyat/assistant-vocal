# Summary 07-01 — Connexion des MCP depuis l'application
**Status**: Complete · **Requirements**: ORC-01, ORC-07 · **Date**: 2026-10-09
## What was built
- `server/oauth-mcp.js` : découverte (protected resource → AS metadata), inscription dynamique, PKCE, échange, rafraîchissement, révocation ; repli `localhost` + collage de l'adresse quand le serveur refuse l'adresse du Worker (Agenda Hub)
- `server/catalogue.js` : 29 serveurs vérifiés par sonde (DCR OK) ; `POST /api/mcp/catalogue/:id`
- Ajout libre (`POST /api/mcp`) avec détection automatique du mode (jeton / OAuth) ; pages `/outils`, `/connect/:nom`
- Agenda Hub déclaré par variables (`MCP_URL_AGENDA`, `MCP_AUTH_AGENDA=oauth`) ; Zapier provisionné (9 apps, 158 actions)
## Verification
oauth.test.js, chat.test.js (catalogue, ajout) ; Agenda Hub connecté et interrogé en réel (rendez-vous du jour).
