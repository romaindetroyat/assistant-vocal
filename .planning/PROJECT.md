# Assistant vocal PWA (multi-MCP)

## What This Is

Un assistant personnel installable en PWA (téléphone et ordinateur), hébergé sur Cloudflare Workers, auquel Romain
parle (dictée, conversation en direct GPT-Realtime) ou écrit, avec photos et collages. Claude Opus 5.5 est le
cerveau : il choisit seul le bon outil parmi les serveurs MCP connectés (Agenda Hub, catalogue OAuth en un clic),
les outils intégrés (Gmail multi-comptes, Bring!, tâches, mémoire, rappels, notifications) et la recherche web.
L'assistant est lui-même un serveur MCP utilisable depuis claude.ai, et il peut demander ses propres évolutions
(issue GitHub → Claude Code → pull request → déploiement automatique).

## Core Value

Dire une phrase et obtenir l'action faite (ou la réponse) via le bon outil, sans naviguer dans des menus.

## Requirements

### Validated

- PWA installable, accès par mot de passe, historique partagé entre appareils
- Dictée, texte, images, vocaux ; lecture à voix haute ; conversation en direct (GPT-Realtime + Claude)
- Connecteur MCP de l'API Claude : serveurs déclarés par configuration, catalogue de 29 services en un clic, OAuth
  avec inscription dynamique, Agenda Hub (retour manuel), Zapier
- Gmail en direct sur trois comptes avec signatures ; Bring! ; notifications push et rappels programmés
- L'assistant exposé en serveur MCP OAuth 2.1 pour claude.ai
- Boucle de développement : `demander_developpement` → issue → Claude Code Actions → PR → déploiement CI
- Consignes personnelles, mémoire de personnalisation auto-alimentée, liste de tâches intelligente, point du matin

### Active

- [ ] Validation en usage quotidien (téléphone, voix, conversation) et ajustements de concision
- [ ] v2 : voir ROADMAP (synthèse hebdomadaire de la mémoire, brief du matin complet, agenda Google direct)

### Out of Scope

- Multi-utilisateurs — usage personnel, un mot de passe
- MCP locaux (stdio) — le connecteur MCP de l'API n'accepte que des serveurs HTTP distants
- Réutilisation des connecteurs OAuth de claude.ai — jetons non exportables
- Audio natif vers Claude — l'API ne prend pas d'audio ; la voix passe par le navigateur ou GPT-Realtime

## Context

- Dépôt dédié `romaindetroyat/assistant-vocal`, Worker `assistant-vocal` (compte Cloudflare d8e3da70…),
  KV `assistant-vocal-data`, URL https://assistant-vocal.romaindetroyat.workers.dev
- Secrets Worker : ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID), ASSISTANT_PASSWORD, SESSION_SECRET, VAPID_*,
  OPENAI_API_KEY, GITHUB_TOKEN ; identifiants Google et Bring! saisis dans l'application (KV)
- GitHub Actions : `ci.yml` (tests), `deploy.yml` (wrangler + secrets), `claude.yml` (Claude Code sur @claude)

## Constraints

- **Tech stack** : Node 22 / Workers (`nodejs_compat`), Hono, `@anthropic-ai/sdk`, PWA vanilla sans build
- **Modèle** : `claude-opus-5-5`, thinking adaptatif, effort `medium` (texte) / `low` (voix), fallbacks `default`
- **API** : au plus 20 outils `strict` et schéma global limité → mode strict réservé à six outils (tools.js)
- **Sécurité** : jetons et identifiants uniquement côté serveur ; jetons OAuth du serveur MCP hachés ; PKCE obligatoire
- **Hébergement** : fichiers statiques embarqués dans le bundle (l'envoi d'assets Cloudflare est incompatible
  avec le proxy de la session de développement)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Connecteur MCP de l'API Claude plutôt qu'un client MCP maison | Anthropic gère les connexions ; zéro client à écrire | ✓ Good |
| Historique et données en KV (fichiers JSON sur Node) via une façade de stockage | Un code, deux runtimes | ✓ Good |
| Push via `@block65/webcrypto-web-push` | WebCrypto : Node et Workers | ✓ Good |
| GPT-Realtime comme voix, Claude comme cerveau (option B) | Garde MCP, historique, rappels ; latence et interruptions natives | ✓ Good |
| OAuth client générique avec repli « coller l'adresse » | Serveurs qui refusent l'adresse de retour (Agenda Hub) | ⚠️ Revisit si Agenda Hub accepte le callback |
| Gmail en direct (API Gmail) plutôt que le MCP Gmail de Google | Le MCP Google (aperçu) n'envoie pas de mails | ✓ Good |
| Assistant exposé en MCP avec son propre serveur OAuth 2.1 | Connecteur claude.ai en un clic | ✓ Good |
| Développement par issue @claude + PR + déploiement CI | Faire évoluer l'outil depuis l'outil | ✓ Good |
| Mémoire alimentée par l'assistant (outil memoire_noter) plutôt qu'extraction batch | Simple, immédiat, visible et corrigeable | — Pending (à valider à l'usage) |

---
*Last updated: 2026-10-10 after passage en mode GSD complet*
