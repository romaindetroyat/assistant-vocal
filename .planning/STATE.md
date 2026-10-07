# State

## Current Position

- Milestone: v1 — 4 phases exécutées, en attente de validation réelle (UAT)
- Last action: code, tests (10/10) et documentation livrés dans le dépôt dédié

## Decisions Log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-07 | Dépôt GitHub dédié `assistant-vocal` | Compartimenter par rapport aux autres projets |
| 2026-10-07 | JS ESM sans build, Hono + @anthropic-ai/sdk | Rapidité et fiabilité demandées |
| 2026-10-07 | Modèle `claude-opus-5-5`, effort `medium`, fallbacks `default` | Qualité du choix d'outil, latence acceptable |
| 2026-10-07 | Blocs `fallback` retirés de l'historique rejoué | Blocs informatifs, inutiles au modèle |
| 2026-10-07 | Transcription des vocaux via service HTTP externe configurable | Pas de dépendance imposée ; la dictée navigateur couvre l'usage principal |

## Blockers

- Validation de bout en bout (clé API, serveurs MCP réels, push sur téléphone) à faire par Romain

## Next

- `/gsd-verify-work` après déploiement HTTPS : dictée, photo, rappel, e-mail via MCP
- v2 : mémoire longue durée, mot d'activation, TTS premium
