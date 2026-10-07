# State

## Current Position

- Milestone: v1 — 4 phases exécutées, en attente de validation réelle (UAT)
- Last action: adaptation Cloudflare Workers (KV namespace `assistant-vocal-data` créé), tests 12/12, Worker validé en local avec wrangler dev

## Decisions Log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-07 | Dépôt GitHub dédié `assistant-vocal` | Compartimenter par rapport aux autres projets |
| 2026-10-07 | JS ESM sans build, Hono + @anthropic-ai/sdk | Rapidité et fiabilité demandées |
| 2026-10-07 | Modèle `claude-opus-5-5`, effort `medium`, fallbacks `default` | Qualité du choix d'outil, latence acceptable |
| 2026-10-07 | Blocs `fallback` retirés de l'historique rejoué | Blocs informatifs, inutiles au modèle |
| 2026-10-07 | Hébergement Cloudflare Workers (KV, assets, cron) en plus de Node | Demande de Romain ; HTTPS et PWA immédiats |
| 2026-10-07 | Push via `@block65/webcrypto-web-push` (WebCrypto) au lieu de `web-push` | Un seul code pour Node et Workers |
| 2026-10-07 | Transcription des vocaux via service HTTP externe configurable | Pas de dépendance imposée ; la dictée navigateur couvre l'usage principal |

## Blockers

- Déploiement Cloudflare : secrets GitHub `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` à créer par Romain (le workflow déploie ensuite seul)
- Validation de bout en bout (clé API, serveurs MCP réels, push sur téléphone) à faire par Romain

## Next

- `/gsd-verify-work` après déploiement HTTPS : dictée, photo, rappel, e-mail via MCP
- v2 : mémoire longue durée, mot d'activation, TTS premium
