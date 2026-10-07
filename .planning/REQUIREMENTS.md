# Requirements: Assistant vocal PWA

**Defined:** 2026-10-07
**Core Value:** Dire une phrase et obtenir l'action faite via le bon outil.

## v1 Requirements

### Accès (ACC)

- [x] **ACC-01**: L'application est une PWA installable (manifest, icônes, service worker) servie en HTTPS
- [x] **ACC-02**: L'accès est protégé par un mot de passe unique, session persistante (cookie signé)
- [x] **ACC-03**: L'interface fonctionne sur mobile (gutter 16 px, pas de scroll horizontal) et desktop

### Entrées (IN)

- [x] **IN-01**: Dictée vocale continue via Web Speech API (bouton micro, envoi automatique à la fin de phrase)
- [x] **IN-02**: Saisie texte et copier-coller de texte
- [x] **IN-03**: Collage ou pièce jointe d'images (photos, captures) envoyées au modèle en base64
- [x] **IN-04**: Enregistrement d'un vocal, transcrit via un service HTTP configurable, puis envoyé
- [x] **IN-05**: Repli clair quand le navigateur ne sait pas dicter (message + saisie texte)

### Orchestration (ORC)

- [x] **ORC-01**: Les serveurs MCP sont déclarés dans `mcp.config.json` (nom, URL, description, jeton via env)
- [x] **ORC-02**: Chaque requête passe à l'API Claude `mcp_servers` + un `mcp_toolset` par serveur
- [x] **ORC-03**: Le prompt système décrit chaque serveur pour un choix d'outil rapide et fiable
- [x] **ORC-04**: Réponse en streaming (SSE) avec affichage des outils appelés en temps réel
- [x] **ORC-05**: Historique de conversation stocké côté serveur et partagé entre appareils
- [x] **ORC-06**: Fallback serveur activé en cas de refus de sécurité

### Sorties (OUT)

- [x] **OUT-01**: Lecture à voix haute de la réponse (speechSynthesis, voix française, activable/désactivable)
- [x] **OUT-02**: Envoi d'e-mails et de messages via les serveurs MCP configurés (Gmail, Matrix…)
- [x] **OUT-03**: Notification push immédiate via l'outil local `notify_me`
- [x] **OUT-04**: Rappel programmé via l'outil local `schedule_reminder`, livré en push à l'heure dite

## v2 Requirements

- **IN-06**: Mode mains-libres avec mot d'activation
- **ORC-07**: Mémoire longue durée (préférences, personnes, projets)
- **OUT-05**: Réponse vocale par un service TTS premium
- **ACC-04**: Partage avec un second utilisateur

## Out of Scope

| Feature | Reason |
|---------|--------|
| MCP locaux (stdio) | Le connecteur MCP de l'API n'accepte que des URL distantes |
| Réutiliser les connecteurs claude.ai | Jetons OAuth non exportables |
| Framework front (React…) | Zéro build = déploiement et débogage plus simples |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACC-01..03 | Phase 1 | Complete |
| ORC-01..06 | Phase 2 | Complete |
| IN-01..05 | Phase 3 | Complete |
| OUT-01..04 | Phase 4 | Complete |

**Coverage:** 18 exigences v1, 18 couvertes, 0 non couverte.

---
*Requirements defined: 2026-10-07*
