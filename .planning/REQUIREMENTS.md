# Requirements: Assistant vocal PWA

**Defined:** 2026-10-07 · **Updated:** 2026-10-10 (v3 planifiée)
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

- [x] **PER-04** Synthèse périodique de la mémoire (fusion, obsolescence) par Claude
- [x] **PER-05** Brief du matin complet (agenda + tâches + mails importants) en push et à la voix
- **INT-06** Element/Matrix TakeOff si un MCP OAuth standard est exposé
- [x] **IN-07** Mot d'activation mains libres
- [x] **ORC-09** Compaction serveur des longues conversations

## v3 Requirements — Mobilité iPhone (planifiées)

### Trajets (TRA)
- **TRA-01** Durée de trajet avec trafic et itinéraire (voiture, transports, marche, vélo) via Google Routes, lien Plans / Google Maps
- **TRA-02** Adresses domicile et bureau, position actuelle partagée sur demande
- **TRA-03** Heure de départ des rendez-vous dans le brief du matin et rappel push « Partez maintenant »

### Partage (PAR)
- **PAR-01** Jetons d'appareil (création, révocation, hachage) pour les appels depuis Raccourcis iOS
- **PAR-02** `POST /api/partage` : texte, URL, image + consigne → action de l'assistant, réponse + push
- **PAR-03** Web Share Target (Android, ordinateur) et guide du raccourci iOS de partage

### Raccourcis Siri (SIRI)
- **SIRI-01** `POST /api/raccourci` : question dictée → réponse courte énoncée par Siri (< 15 s, repli push)
- **SIRI-02** Liens profonds `/app?action=appel|brief`, `/app?dire=…`, `/app?mode=voiture`
- **SIRI-03** Guides pas à pas des raccourcis dans « Mes outils »

### Mode voiture (VOI)
- **VOI-01** Affichage voiture : un bouton, grandes lettres, sombre, écran maintenu allumé
- **VOI-02** Conversation permanente avec reprise mains libres, concision renforcée, contexte « conducteur »
- **VOI-03** Rappels et notifications lus à voix haute pendant le mode voiture

## Out of Scope

| Feature | Reason |
|---------|--------|
| INT-05 Google Agenda en direct | Agenda Hub couvre déjà les quatre comptes (décision 2026-10-10) |
| MCP locaux (stdio) | Connecteur API = URL distantes seulement |
| Connecteurs claude.ai réutilisés | Jetons OAuth non exportables |
| Framework front | Zéro build, déploiement simple |
| Écoute mains libres écran verrouillé sur iPhone | Impossible pour une app web (iOS coupe le micro) : contourné par les raccourcis Siri |
| CarPlay | Réservé aux apps natives |

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
| PER-05 | 13 | Validated |
| PER-04 | 14 | Validated |
| IN-07, ORC-09 | 15 | Validated |
| INT-06 | backlog | Pending |
| TRA-01..03 | 16 | Planned |
| PAR-01..03 | 17 | Planned |
| SIRI-01..03 | 18 | Planned |
| VOI-01..03 | 19 | Planned |

---
*Last updated: 2026-10-10 after passage en mode GSD complet*
