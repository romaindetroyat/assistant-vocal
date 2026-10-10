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

## Milestone v2 — à planifier (`/gsd-plan-phase 13`)

### Phase 13 — Brief du matin complet
**Goal**: à 8 h, un push et un résumé vocal : agenda du jour (Agenda Hub), tâches, mails importants.
**Requirements**: PER-05 · **Success criteria**: un seul push le matin, lisible en 20 secondes ; « fais-moi le brief » à la voix.

### Phase 14 — Mémoire consolidée
**Goal**: synthèse hebdomadaire de la mémoire par Claude (fusion des doublons, obsolescence, profil court).
**Requirements**: PER-04 · **Success criteria**: profil ≤ 60 lignes, aucune contradiction, journal des changements visible.

### Phase 15 — Google Agenda en direct
**Goal**: lire et créer des rendez-vous sur les comptes Google connectés sans passer par Agenda Hub.
**Requirements**: INT-05 · **Success criteria**: même OAuth que Gmail (portée calendar), fusion avec Agenda Hub.

### Phase 16 — Mains libres et compaction
**Requirements**: IN-07, ORC-09.

## Progress

12 phases livrées sur 12 (v1). v2 non commencée.
