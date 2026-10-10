# Requirements: Assistant vocal PWA

**Defined:** 2026-10-07 · **Updated:** 2026-10-10
**Core Value:** Dire une phrase et obtenir l'action faite via le bon outil.

## v1 Requirements (livrées)

### Accès (ACC)
- [x] **ACC-01** PWA installable servie en HTTPS (Cloudflare Workers)
- [x] **ACC-02** Mot de passe unique, cookie signé 90 jours
- [x] **ACC-03** Interface mobile et desktop

### Entrées (IN)
- [x] **IN-01** Dictée Web Speech enchaînée, silence géré, appui maintenu
- [x] **IN-02** Texte et collage
- [x] **IN-03** Images (collage, pièce jointe, caméra)
- [x] **IN-04** Vocal enregistré → service de transcription configurable
- [x] **IN-05** Repli explicite sans dictée
- [x] **IN-06** Conversation en direct GPT-Realtime (`gpt-realtime-2.1-mini`), reconnexion automatique

### Orchestration (ORC)
- [x] **ORC-01** Serveurs MCP par configuration (`MCP_URL_<NOM>`, JSON) et depuis l'application
- [x] **ORC-02** `mcp_servers` + `mcp_toolset` par requête
- [x] **ORC-03** Prompt système : carte des outils, consignes, mémoire
- [x] **ORC-04** Streaming SSE avec outils affichés
- [x] **ORC-05** Historique partagé entre appareils
- [x] **ORC-06** Fallback serveur en cas de refus
- [x] **ORC-07** OAuth client générique (découverte, DCR, PKCE, rafraîchissement) + catalogue de 29 services
- [x] **ORC-08** Effort `low` pour les demandes vocales ; réglages voix et concision

### Sorties (OUT)
- [x] **OUT-01** Lecture à voix haute ; voix OpenAI au choix avec aperçu
- [x] **OUT-02** E-mails : Gmail en direct (3 comptes, signatures) ; messages via MCP
- [x] **OUT-03** Notification push immédiate
- [x] **OUT-04** Rappels programmés (cron chaque minute)

### Intégrations (INT)
- [x] **INT-01** Gmail multi-comptes (chercher, lire, répondre, envoyer, brouillons, signatures)
- [x] **INT-02** Bring! (listes, lire, ajouter, cocher, retirer)
- [x] **INT-03** L'assistant exposé en serveur MCP OAuth 2.1 (claude.ai)
- [x] **INT-04** Boucle de développement : issue @claude → Claude Code → PR → déploiement CI

### Personnalisation (PER)
- [x] **PER-01** Consignes personnelles (réglage + outils retenir/oublier)
- [x] **PER-02** Mémoire de personnalisation auto-alimentée, consultable, corrigeable
- [x] **PER-03** Tâches intelligentes (échéance, heure, priorité, projet, rappel 15 min, page, point du matin)

## v2 Requirements (backlog)

- **PER-04** Synthèse périodique de la mémoire (fusion, obsolescence) par Claude
- **PER-05** Brief du matin complet (agenda + tâches + mails importants) en push et à la voix
- **INT-05** Google Agenda en direct (même OAuth que Gmail) pour les comptes sans Agenda Hub
- **INT-06** Element/Matrix TakeOff si un MCP OAuth standard est exposé
- **IN-07** Mot d'activation mains libres
- **ORC-09** Compaction serveur des longues conversations

## Out of Scope

| Feature | Reason |
|---------|--------|
| MCP locaux (stdio) | Connecteur API = URL distantes seulement |
| Connecteurs claude.ai réutilisés | Jetons OAuth non exportables |
| Framework front | Zéro build, déploiement simple |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACC-01..03 | 1 | Validated |
| ORC-01..06 | 2 | Validated |
| IN-01..05 | 3 | Validated |
| OUT-01..04 | 4 | Validated |
| Hébergement Cloudflare | 5 | Validated |
| IN-06, ORC-08 | 6 | Validated |
| ORC-07 | 7 | Validated |
| INT-01 | 8 | Validated |
| INT-03 | 9 | Validated |
| INT-04 | 10 | Validated |
| INT-02 | 11 | Validated |
| PER-01..03 | 12 | Validated |
| PER-04, PER-05, INT-05, INT-06, IN-07, ORC-09 | v2 | Pending |

---
*Last updated: 2026-10-10 after passage en mode GSD complet*
