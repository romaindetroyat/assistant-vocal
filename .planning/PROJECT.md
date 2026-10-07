# Assistant vocal PWA (multi-MCP)

## What This Is

Un assistant personnel installable en PWA, utilisable depuis l'ordinateur et le téléphone, auquel Romain
parle principalement à la voix (ou envoie texte, copier-coller, photos, vocaux). Il est connecté à tous les
serveurs MCP distants de Romain (agenda, mail, Notion, Matrix, Airtable…) via le connecteur MCP de l'API
Claude, choisit seul le bon outil, et répond à l'oral, par e-mail, par message ou par notification push.

## Core Value

Dire une phrase et obtenir l'action faite (ou la réponse) via le bon outil, sans naviguer dans des menus.

## Requirements

### Validated

(Rien encore — à valider en usage réel)

### Active

- [ ] PWA installable (manifest, service worker, HTTPS) accessible ordinateur + téléphone
- [ ] Entrées : voix (dictée), texte, copier-coller (texte et images), photos, enregistrements vocaux
- [ ] Connexion à N serveurs MCP distants par simple fichier de configuration
- [ ] Sélection rapide et fiable de l'outil (prompt système décrivant chaque serveur)
- [ ] Sorties : réponse lue à voix haute, e-mail / message via MCP, notification push (immédiate ou programmée)
- [ ] Historique de conversation partagé entre appareils (stocké côté serveur)
- [ ] Accès protégé par mot de passe (usage mono-utilisateur)

### Out of Scope

- Multi-utilisateurs / comptes — usage personnel, un mot de passe suffit
- Serveurs MCP locaux (stdio) — le connecteur MCP de l'API Claude n'accepte que des serveurs HTTP distants
- Réutilisation des connecteurs OAuth de claude.ai — leurs jetons ne sont pas exportables ; chaque serveur
  MCP doit fournir sa propre URL et son propre jeton
- Transcription audio côté serveur « maison » — on branche un service de transcription HTTP configurable

## Context

- Dépôt GitHub dédié `assistant-vocal`, indépendant des autres projets (Culture Gé, etc.).
- Romain dispose déjà de nombreux MCP (Agenda Hub, Gmail, Google Calendar/Drive, Notion, Airtable,
  Element/Matrix, n8n, Make, Zapier, Supabase, Vercel, Cloudflare…).
- Le navigateur fournit gratuitement dictée (Web Speech API) et synthèse vocale (speechSynthesis).

## Constraints

- **Tech stack** : Node 22, Hono, `@anthropic-ai/sdk`, PWA vanilla (zéro build) — fiabilité et rapidité
- **Modèle** : `claude-opus-5-5` par défaut, thinking adaptatif, effort configurable, fallback serveur activé
- **Sécurité** : jetons MCP uniquement côté serveur (variables d'environnement), jamais dans le navigateur
- **Hébergement** : n'importe quel hôte Node/Docker avec HTTPS (nécessaire pour PWA, micro et push)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Backend Node + connecteur MCP de l'API Claude | Anthropic gère les connexions MCP côté serveur : zéro client MCP à écrire | — Pending |
| Historique stocké côté serveur (fichiers JSON) | Partage ordi/téléphone sans base de données | — Pending |
| Dictée et voix via le navigateur, transcription HTTP en option | Gratuit, immédiat, hors ligne ; service externe seulement pour les vocaux enregistrés | — Pending |
| Notifications via Web Push (VAPID) + rappels programmés | Marche sur Android, iOS (PWA installée) et desktop | — Pending |

---
*Last updated: 2026-10-07 after project initialisation*
