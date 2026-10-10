# Roadmap: Assistant vocal PWA

## Milestone v1 — livré (2026-10-07 → 2026-10-10)

| Phase | Status | Summary |
|-------|--------|---------|
| 1 — Socle (serveur, auth, PWA) | Complete | Hono, cookie HMAC, PWA installable |
| 2 — Orchestration MCP et conversation | Complete | Connecteur MCP, prompt, SSE, historique partagé |
| 3 — Entrées multimodales | Complete | Dictée, images, vocaux |
| 4 — Sorties | Complete | Voix, push, rappels |
| 5 — Hébergement Cloudflare Workers | Complete | KV, assets embarqués, cron, déploiement CI |
| 6 — Conversation en direct | Complete | GPT-Realtime (voix) + Claude (cerveau), reconnexion, réglages voix/concision |
| 7 — Connexion des MCP depuis l'application | Complete | OAuth client générique, Agenda Hub, catalogue 29 services, ajout libre |
| 8 — Gmail en direct | Complete | OAuth Google multi-comptes, 7 outils, signatures |
| 9 — L'assistant en serveur MCP | Complete | OAuth 2.1 (DCR, PKCE), /mcp, connecteur claude.ai |
| 10 — Boucle de développement | Complete | demander_developpement → issue → Claude Code Actions → PR → déploiement |
| 11 — Bring! | Complete | Listes de courses à la voix |
| 12 — Personnalisation | Complete | Consignes, mémoire auto-alimentée, tâches intelligentes, point du matin |

## Milestone v2 — livré (2026-10-10, trois phases exécutées en parallèle)

| Phase | Status | Summary |
|-------|--------|---------|
| 13 — Brief du matin complet | Complete | brief.js, outil brief_du_jour, un seul push à 8 h, /api/brief, section « Mes outils » |
| 14 — Mémoire consolidée | Complete | memoire-consolidation.js, consolidation hebdo par Claude, journal visible, plafond 60 |
| 15 — Mains libres et compaction | Complete | mot d'activation + veille, raccrochage après 45 s de silence, compaction serveur > 120 k caractères, résumé visible |

### Détail des phases v2

### Phase 13 — Brief du matin complet
**Goal**: à 8 h, un push et un résumé vocal : agenda du jour (Agenda Hub), tâches, mails importants.
**Requirements**: PER-05 · **Success criteria**: un seul push le matin, lisible en 20 secondes ; « fais-moi le brief » à la voix.

### Phase 14 — Mémoire consolidée
**Goal**: synthèse hebdomadaire de la mémoire par Claude (fusion des doublons, obsolescence, profil court).
**Requirements**: PER-04 · **Success criteria**: profil ≤ 60 lignes, aucune contradiction, journal des changements visible.

### Phase 15 — Mains libres et compaction
**Goal**: conversation en direct utilisable sans toucher l'écran (mot d'activation, reprise automatique) et conversations longues compactées côté serveur pour rester rapides et sous la limite de contexte.
**Requirements**: IN-07, ORC-09 · **Success criteria**: dire le mot d'activation relance l'écoute ; une conversation de 60 tours reste fluide et se poursuit sans erreur de contexte, l'historique résumé étant visible.

> Google Agenda en direct (ex-phase 15, INT-05) abandonné le 2026-10-10 : Agenda Hub suffit.

## Progress

15 phases livrées sur 15 (v1 + v2). v3 à définir d'après l'usage (reste au backlog : INT-06 Element/Matrix).
