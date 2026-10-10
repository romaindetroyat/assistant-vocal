# State

## Current Position

- Milestone: v1 livré ; v2 à planifier (phase 13 = brief du matin)
- Last action: passage complet en mode GSD (docs, CLAUDE.md, boucle de dev alignée) — 2026-10-10
- Production : https://assistant-vocal.romaindetroyat.workers.dev (déploiement auto sur `main`)
- Tests : 39 (`npm test`)

## Decisions Log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-07 | Dépôt dédié, JS ESM sans build, Hono + SDK Anthropic, Opus 5.5 | Rapidité, fiabilité |
| 2026-10-07 | Cloudflare Workers + KV, assets embarqués | HTTPS immédiat ; upload d'assets incompatible avec le proxy |
| 2026-10-08 | Dictée en mode phrase enchaîné + appui maintenu | Mode continu instable selon navigateur |
| 2026-10-08 | GPT-Realtime 2.1 mini en voix, Claude en cerveau ; effort low pour la voix | Latence, interruptions |
| 2026-10-09 | OAuth client générique + catalogue vérifié par sonde | Connexions en un clic depuis l'app |
| 2026-10-09 | Gmail API directe (pas le MCP Google en aperçu) | Envoi et réponse nécessaires |
| 2026-10-10 | Serveur OAuth 2.1 maison pour exposer l'assistant | claude.ai exige DCR + PKCE |
| 2026-10-10 | Claude Code Actions + PR + déploiement CI | Développer l'outil depuis l'outil |
| 2026-10-10 | Mode strict limité à 6 outils | Limite API (20 stricts, complexité globale) |
| 2026-10-10 | Mémoire alimentée par l'assistant via outil | Simple, visible, corrigeable |

## Blockers

- Aucun. Point d'attention : Agenda Hub exige un retour par collage (adresse du Worker non autorisée).

## Next

- Usage quotidien et retours de Romain (concision, voix, tâches)
- `/gsd-discuss-phase 13` puis `/gsd-plan-phase 13` pour le brief du matin
- Toute nouvelle demande passe par une phase GSD (voir CLAUDE.md), y compris via `demander_developpement`
