# State

## Current Position

- Milestone: v3 « Mobilité iPhone » livrée (phases 16 à 19) le 2026-10-10 ; tests réels iPhone à faire par Romain
- Last action: fusion des phases 16, 18, 19 (worktrees parallèles), cache SW v21 — 2026-10-10
- Production : https://assistant-vocal.romaindetroyat.workers.dev (déploiement auto sur `main`)
- Tests : 77 (`npm test`)

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
| 2026-10-10 | Abandon de Google Agenda en direct (ex-phase 15) | Agenda Hub couvre les quatre comptes |
| 2026-10-10 | Phases v2 exécutées en parallèle dans des worktrees, fusion manuelle | Rapidité ; conflits limités à scheduler/worker/index |
| 2026-10-10 | iPhone : partage et Siri via raccourcis iOS + jetons d'appareil (pas de Web Share Target sur Safari) | Seule voie fiable sur iOS |
| 2026-10-10 | Trajets via Google Routes (clé saisie dans l'app) | Trafic réel et transports ; cohérent avec « connexions depuis l'app » |
| 2026-10-10 | Veille iPhone par écoute locale + transcription courte (OpenAI) | SpeechRecognition inutilisable sur iOS |
| 2026-10-10 | Compaction par seuil de caractères (120 k), 6 derniers messages intacts | Simple, sans compteur de tokens |

## Blockers

- Aucun. Point d'attention : Agenda Hub exige un retour par collage (adresse du Worker non autorisée).

## Next

- Usage quotidien et retours de Romain (concision, voix, tâches)
- Romain : coller la clé Routes (Mes outils › Trajets), créer un jeton d'appareil et les raccourcis iOS (partage, Siri, voiture), tester en voiture
- Retours d'usage → corrections en `/gsd-quick` ; prochaine version à définir d'après l'usage
- Vérifier en production : brief du matin demain 8 h (un seul push), consolidation mémoire au premier cron après 7 jours, veille mains libres sur Chrome Android / iPhone
- iPhone = cible principale : vérifier la veille « écoute locale » (app ouverte à l'écran) et le vocal 🎙️ désormais actif
- Toute nouvelle demande passe par une phase GSD (voir CLAUDE.md), y compris via `demander_developpement`
