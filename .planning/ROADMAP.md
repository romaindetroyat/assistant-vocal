# Roadmap: Assistant vocal PWA

## Overview

Quatre phases courtes, chacune livrant quelque chose de testable. L'ordre suit la dépendance :
on ne peut pas tester la voix sans l'orchestration, ni l'orchestration sans un serveur protégé.

## Phases

### Phase 1 — Socle : serveur, authentification, PWA
**Goal**: Un serveur Hono sert une PWA installable protégée par mot de passe.
**Requirements**: ACC-01, ACC-02, ACC-03
**Success criteria**:
1. `npm start` lance le serveur ; `/` sans session redirige vers la page de connexion
2. Avec le bon mot de passe, un cookie signé donne accès à l'application
3. Lighthouse reconnaît la PWA (manifest + service worker) ; installable sur téléphone

### Phase 2 — Orchestration MCP et conversation
**Goal**: Une requête texte déclenche le bon outil MCP et répond en streaming.
**Requirements**: ORC-01 à ORC-06
**Success criteria**:
1. `mcp.config.json` suffit à ajouter un serveur (aucune ligne de code)
2. Les appels d'outils s'affichent pendant la génération
3. L'historique est le même depuis deux navigateurs

### Phase 3 — Entrées multimodales
**Goal**: Voix, photos, collages et vocaux arrivent correctement au modèle.
**Requirements**: IN-01 à IN-05
**Success criteria**:
1. Parler puis se taire envoie la phrase
2. Coller une capture d'écran l'affiche et le modèle la décrit
3. Un vocal enregistré est transcrit si un service est configuré, sinon message explicite

### Phase 4 — Sorties : voix, notifications, rappels
**Goal**: L'assistant répond à l'oral et peut notifier, immédiatement ou plus tard.
**Requirements**: OUT-01 à OUT-04
**Success criteria**:
1. La réponse est lue à voix haute quand le mode voix est actif
2. « Rappelle-moi dans 10 minutes de… » produit une notification push à l'heure dite
3. « Envoie un mail à … » passe par le MCP mail configuré

## Progress

| Phase | Status | Summary |
|-------|--------|---------|
| 1 | Complete | Serveur Hono, auth cookie, PWA installable |
| 2 | Complete | Connecteur MCP, prompt système, streaming SSE, historique partagé |
| 3 | Complete | Dictée, images, vocaux transcrits |
| 4 | Complete | Voix, push, rappels programmés |
| 5 | Complete | Hébergement Cloudflare Workers (KV, assets, cron, déploiement CI) |

### Phase 5 — Hébergement Cloudflare Workers
**Goal**: Même code déployable sur Cloudflare (HTTPS, PWA installable immédiatement).
**Success criteria**: `wrangler dev` sert l'app complète ; push sur `main` déploie via GitHub Actions.
