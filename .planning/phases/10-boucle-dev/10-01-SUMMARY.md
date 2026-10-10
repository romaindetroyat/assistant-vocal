# Summary 10-01 — Boucle de développement
**Status**: Complete · **Requirements**: INT-04 · **Date**: 2026-10-10
## What was built
- `server/dev.js` : outil `demander_developpement` → issue GitHub « @claude » (jeton à granularité fine, Issues RW)
- `.github/workflows/claude.yml` : Claude Code Actions (deps installées, tests autorisés, PR ouverte par Claude ou par le workflow en secours, ignore ses propres commentaires)
- `.github/workflows/deploy.yml` corrigé (contexte `secrets` interdit dans un `if` de job) ; déploiement auto sur `main`
## Verification
Issue #1 → branche → PR #2 fusionnée → déployée ; `deploy.yml` vert (run 38021500502).
