# Summary 05-01 — Hébergement Cloudflare Workers

**Status**: Complete (déploiement en attente des secrets GitHub) · **Date**: 2026-10-07

## What was built

- `server/app.js` : application Hono indépendante du runtime (statique injecté, client et serveurs MCP paresseux)
- `server/worker.js` : entrée Workers (KV `DATA`, assets `ASSETS`, cron `scheduled`, 503 explicite si secrets absents)
- `server/store.js` façade + `store-fs.js` (Node) + `store-kv.js` (Cloudflare) ; `push.js` via WebCrypto
- `wrangler.jsonc` (nodejs_compat, assets run_worker_first, KV `86626561bfdf4aae803f9d00762e69fe`, cron chaque minute)
- `.github/workflows/deploy.yml` : wrangler-action + envoi des secrets présents dans GitHub

## Verification

- `npm test` 12/12 · `wrangler deploy --dry-run` OK · `wrangler dev --local` : login, assets, KV, SSE, `/__scheduled` OK
