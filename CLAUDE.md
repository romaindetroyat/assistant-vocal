# Assistant vocal — instructions pour Claude Code

Ce dépôt est développé avec **GSD (Get Shit Done)**. Les commandes `/gsd-*` sont installées dans `.claude/`,
la planification vit dans `.planning/`. Lis `.planning/STATE.md` puis `.planning/ROADMAP.md` avant toute tâche.

## Méthode

1. **Toute évolution est une phase ou une tâche rapide GSD.** Nouvelle fonctionnalité → `/gsd-discuss-phase N`
   puis `/gsd-plan-phase N` puis `/gsd-execute-phase N`. Correction ou petit ajustement → `/gsd-quick`.
   Dans GitHub Actions (issue `@claude`), applique la même discipline sans les commandes : lis `.planning/`,
   écris `.planning/phases/<NN>-<slug>/<NN>-01-PLAN.md` (ou `.planning/quick/<date>-<slug>.md`), implémente,
   puis `<NN>-01-SUMMARY.md` et mets à jour `STATE.md` et `ROADMAP.md`.
2. **Tests obligatoires** : `npm test` doit rester vert (Node `node:test`, clients externes simulés par `fetch`
   injecté). Pas de requête réseau réelle dans les tests.
3. **Commits atomiques** en français, un par tâche, message à l'impératif court puis explication.
4. **Déploiement** : fusion sur `main` → `deploy.yml` → Cloudflare. Ne jamais déployer autrement depuis la CI.
   La version et la date affichées dans « Mes outils » viennent de `scripts/inline-assets.mjs`.

## Architecture (lire avant de coder)

- `server/app.js` : application Hono partagée (routes `/api/*`, OAuth, `/mcp`, pages). `server/index.js` = Node,
  `server/worker.js` = Cloudflare. Fichiers statiques de `public/` embarqués par `scripts/inline-assets.mjs`.
- Stockage : façade `server/store.js` (+ `store-fs.js`, `store-kv.js`). Valeurs libres : `lireValeur/ecrireValeur`
  (clés `[a-z0-9:_-]`).
- Cerveau : `server/chat.js` (boucle Claude, outils locaux + MCP + web_search), prompt dans `server/prompt.js`
  (carte des outils, consignes, mémoire). Outils locaux déclarés dans `server/tools.js` via
  `outilsLocauxDisponibles()` : **au plus 20 outils `strict`** et schéma global limité → ne mets `strict: true`
  que si tu l'ajoutes à `STRICTS_PRIORITAIRES`, et garde les schémas simples (pas d'arrays imbriqués profonds).
- Intégrations : `gmail.js`/`google.js`, `bring.js`, `taches.js`, `memoire.js`, `consignes.js`, `dev.js`,
  `oauth-mcp.js` (client), `oauth-server.js` + `mcp-server.js` (serveur MCP exposé), `voice.js` (Realtime).
- Front : `public/app.js` (chat, dictée, voix, push), `conversation.js` (WebRTC), pages `outils.html`,
  `taches.html`, `connect.html`. Incrémente `CACHE` dans `public/sw.js` à chaque changement de fichier statique.

## Conventions

- Code et textes en français ; identifiants d'API (`strict`, `input_schema`…) tels quels.
- Modèle Claude : `claude-opus-5-5`, `thinking: adaptive`, `output_config.effort` ; ne jamais ajouter de
  `budget_tokens`, de prefill ni de `tool_choice` forcé.
- Secrets uniquement côté serveur ; jamais de jeton dans le prompt, les journaux ou le front.
- Quand tu ajoutes un outil local, ajoute-le aussi à la liste du prompt (`prompt.js`) et un test.
