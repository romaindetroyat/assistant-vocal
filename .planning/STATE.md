# State

## Current Position

- Milestone: v4 « Quotidien » en cours : phases 20 (météo), 21 (extension, raccourcis, autorisations), 22 (coffre de documents), 23 (interface Ardoise) livrées
- Last action: phase 23 interface « Ardoise » (rail, transcription à droite, curseurs modèle et longueur, voiture restylée), cache SW v35 — 2026-10-11
- Production : https://assistant-vocal.romaindetroyat.workers.dev (déploiement auto sur `main`)
- Tests : 101 (`npm test`)

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
| 2026-10-10 | Mode strict désactivé ; MCP secondaires à la demande ; prompt en cache | Latence : grammaire stricte et connexions MCP coûtaient 10 à 30 s |
| 2026-10-10 | Mémoire alimentée par l'assistant via outil | Simple, visible, corrigeable |
| 2026-10-10 | Abandon de Google Agenda en direct (ex-phase 15) | Agenda Hub couvre les quatre comptes |
| 2026-10-10 | Phases v2 exécutées en parallèle dans des worktrees, fusion manuelle | Rapidité ; conflits limités à scheduler/worker/index |
| 2026-10-10 | iPhone : partage et Siri via raccourcis iOS + jetons d'appareil (pas de Web Share Target sur Safari) | Seule voie fiable sur iOS |
| 2026-10-10 | Trajets via Google Routes (clé saisie dans l'app) | Trafic réel et transports ; cohérent avec « connexions depuis l'app » |
| 2026-10-10 | Veille iPhone par écoute locale + transcription courte (OpenAI) | SpeechRecognition inutilisable sur iOS |
| 2026-10-10 | Météo via Open-Meteo (ECMWF + AROME) plutôt que l'API Meteored | Pas d'API Meteored documentée publiquement ; mêmes modèles, gratuit, sans clé |
| 2026-10-11 | Coffre chiffré côté serveur (AES-GCM) avec fiches extraites par Claude, KV en attendant R2 | Sécurité sans tiers ; usage vocal conservé |
| 2026-10-11 | Mode voiture sans veille forcée, tap = couper la parole | Le tap raccrochait ; la veille transcrivait le bruit de la route |
| 2026-10-11 | Interface « Ardoise » ; modèle et longueur choisis par curseurs ; micro unique (toucher = dictée, maintenir = conversation) | Choix de Romain parmi trois maquettes ; moins de boutons |
| 2026-10-10 | Compaction par seuil de caractères (120 k), 6 derniers messages intacts | Simple, sans compteur de tokens |

## Blockers

- Aucun. Point d'attention : Agenda Hub exige un retour par collage (adresse du Worker non autorisée).

## Next

- Mode voiture : lire `GET /api/diag/client` après le prochain trajet de Romain pour diagnostiquer les coupures restantes
- Coffre : activer R2 (tableau de bord Cloudflare) puis décommenter le binding DOCS ; définir un secret DOCS_KEY dédié

- Usage quotidien et retours de Romain (concision, voix, tâches)
- Décision : Opus 5.5 conservé partout, suivi de consommation dans Mes outils pour juger sur pièces
- Romain : charger l'extension (dossier extension/, mode développeur), coller le jeton dans ses options, tester Ctrl+Maj+Espace ; vérifier les badges Autorisations
- Clé Routes collée et trajets vérifiés ✓ ; reste à Romain : jeton d'appareil + raccourcis iOS (partage, Siri), test en voiture
- Retours d'usage → corrections en `/gsd-quick` ; prochaine version à définir d'après l'usage
- Vérifier en production : brief du matin demain 8 h (un seul push), consolidation mémoire au premier cron après 7 jours, veille mains libres sur Chrome Android / iPhone
- iPhone = cible principale : s'ouvre en mode voiture ; vérifier la veille « écoute locale » et le filtre anti-bruit en conditions réelles
- Lire la section « Consommation Claude » dans 3-4 jours ; si trop cher, basculer la voix et Siri sur Haiku 5.5 (tâche rapide)
- Toute nouvelle demande passe par une phase GSD (voir CLAUDE.md), y compris via `demander_developpement`
