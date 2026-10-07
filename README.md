# Assistant vocal (PWA + MCP)

Assistant personnel installable sur téléphone et ordinateur. On lui parle (dictée), on lui écrit, on lui colle
du texte ou des images, on lui envoie des photos ou des vocaux. Il choisit seul le bon outil parmi les serveurs
MCP configurés (agenda, mail, Notion, messagerie…), répond à l'oral, envoie des e-mails ou des messages via
ces outils, et peut notifier immédiatement ou programmer un rappel.

Développé avec le framework [GSD](https://github.com/glittercowboy/get-shit-done) : la planification vit dans
`.planning/` et les commandes `/gsd-*` sont installées dans `.claude/`.

## Architecture

```
navigateur (PWA)  ──SSE──▶  serveur Node (Hono)  ──▶  API Claude (connecteur MCP)  ──▶  serveurs MCP distants
   dictée / voix              auth, historique,           modèle claude-opus-5-5             agenda, mail, Notion…
   photos / vocaux            outils locaux, push
```

- **Le navigateur** fait la dictée (Web Speech API) et la lecture à voix haute (speechSynthesis) : gratuit, immédiat.
- **Le serveur** garde l'historique (partagé entre appareils), protège l'accès par mot de passe, exécute les outils
  locaux (`notify_me`, `schedule_reminder`…) et envoie les notifications push.
- **L'API Claude** appelle elle-même les serveurs MCP distants (`mcp_servers` + `mcp_toolset`) : aucun client MCP
  à écrire, les jetons restent côté serveur.

## Démarrage

```bash
npm install
cp .env.example .env            # puis renseigner ANTHROPIC_API_KEY, ASSISTANT_PASSWORD, SESSION_SECRET
cp mcp.config.example.json mcp.config.json   # puis déclarer vos serveurs MCP
npm run vapid                   # copier les deux clés dans .env pour activer les notifications push
npm start                       # http://localhost:3000
```

Pour le téléphone, servez l'application en **HTTPS** (obligatoire pour l'installation PWA, le micro et les
notifications) : un reverse proxy (Caddy, Traefik, Cloudflare Tunnel…) ou l'hébergeur de votre choix via le
`Dockerfile`. Sur iPhone, ajoutez l'app à l'écran d'accueil avant d'activer les notifications.

## Déclarer des serveurs MCP

`mcp.config.json` :

```json
{
  "servers": [
    {
      "name": "gmail",
      "url": "https://mon-serveur/mcp/gmail",
      "description": "Boîte mail : rechercher, lire, répondre, envoyer.",
      "authorization_token_env": "MCP_GMAIL_TOKEN",
      "allowed_tools": ["search_threads", "send_message"]
    }
  ]
}
```

- `name` : identifiant (lettres, chiffres, `-`, `_`), affiché dans l'interface.
- `description` : **important** — c'est ce qui permet au modèle de choisir vite le bon serveur.
- `authorization_token_env` : nom de la variable d'environnement contenant le jeton (jamais le jeton lui-même).
- `allowed_tools` (optionnel) : liste blanche d'outils ; sans elle, tous les outils du serveur sont exposés.
- `enabled: false` pour désactiver un serveur sans le retirer.

Seuls les serveurs MCP **distants (HTTPS)** sont acceptés par le connecteur de l'API Claude. Les connecteurs
OAuth de claude.ai ne sont pas réutilisables : chaque serveur doit fournir sa propre URL et son propre jeton.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Clé API Claude (obligatoire) |
| `ASSISTANT_PASSWORD`, `SESSION_SECRET` | Accès et signature du cookie de session (obligatoires) |
| `CLAUDE_MODEL`, `CLAUDE_EFFORT` | Modèle (`claude-opus-5-5`) et effort (`low`…`max`, défaut `medium`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Notifications push (`npm run vapid`) |
| `TRANSCRIBE_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | Service de transcription des vocaux enregistrés (API multipart compatible `/v1/audio/transcriptions`) |
| `ASSISTANT_NAME`, `USER_NAME` | Nom de l'assistant et prénom de l'utilisateur dans le prompt |
| `PORT`, `DATA_DIR`, `MCP_CONFIG` | Port, dossier des données, chemin du fichier MCP |

## Tests

```bash
npm test
```

Les tests couvrent l'authentification, l'analyse de la configuration MCP, la boucle de conversation
(outils locaux, blocs MCP rejoués, fallback filtré) et le flux SSE, avec un client Anthropic simulé.
