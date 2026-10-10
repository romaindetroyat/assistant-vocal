# Summary 13-01 — Brief du matin complet
**Status**: Complete · **Requirements**: PER-05 · **Date**: 2026-10-10
## What was built
- `server/brief.js` : `genererBrief` (tour Claude éphémère via `executerTour`, consigne imposant agenda du jour par le serveur MCP d'agenda connecté, `tache_lister aujourdhui`, `gmail_rechercher is:unread is:important newer_than:1d` si compte Gmail, courses si utile ; 4 à 8 phrases sans mise en forme, date en toutes lettres ; effort voix) ; `briefDuMatin` (≥ 8 h Paris, une fois par jour, clé `brief-du-matin`, enregistrement `dernier-brief`, UN push « Votre journée » tronqué à 200 caractères vers `/app`, repli sur `resumeDuJour` si Claude échoue) ; `lireDernierBrief`, `enregistrerBrief`, `resoudreContexteBrief` (serveurs env + ajoutés, jetons OAuth)
- Outil local `brief_du_jour` (non strict, schéma vide) : renvoie le brief du jour ou invite Claude à le composer lui-même ; branché dans `tools.js`, décrit dans la carte des outils de `prompt.js`
- `scheduler.js` : `pointDuMatin` délègue à `briefDuMatin` (plus de double push) ; `demarrerPlanificateur({ client, serveurs })` ; `worker.js` (cron) et `index.js` passent le client Anthropic
- Routes `GET /api/brief` et `POST /api/brief` (génération à la demande) dans `app.js`
- `public/outils.html` : section « Brief du matin » avec dernier brief et bouton « Générer maintenant » ; `sw.js` cache v15
## Verification
`test/brief.test.js` (5 tests : génération, garde quotidienne, repli, outil, routes) ; `npm test` : 44 tests verts, aucune requête réseau. Outils stricts inchangés (6).
## Notes
- `genererBrief` importe `chat.js`/`tools.js` dynamiquement pour éviter le cycle de modules (`tools.js` importe `brief.js`).
- L'agenda est détecté par le nom ou la description du serveur MCP (`agenda|calendar|calendrier`) ; sans serveur, le brief le signale en quelques mots.
- Le worker Cloudflare génère le brief dans `scheduled` : la durée d'un tour Claude avec outils (quelques dizaines de secondes) reste dans les limites du cron grâce à `waitUntil`.
