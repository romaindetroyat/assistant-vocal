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
- **Le serveur** (Node, ou Cloudflare Workers) garde l'historique (partagé entre appareils), protège l'accès par
  mot de passe, exécute les outils locaux (`notify_me`, `schedule_reminder`…) et envoie les notifications push.
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

## Mode conversation vocale (GPT-Realtime + Claude)

Avec une clé OpenAI (`OPENAI_API_KEY`), le bouton 📞 ouvre une conversation en direct : le navigateur se
connecte en WebRTC au modèle vocal d'OpenAI (`gpt-realtime-2.1-mini` par défaut, `OPENAI_REALTIME_MODEL`
pour changer, `OPENAI_REALTIME_VOICE` pour la voix), qui écoute, parle et gère les interruptions. Pour toute
demande réelle, il appelle la fonction `demander_assistant`, que le serveur exécute avec Claude et tous les
outils MCP : Claude reste le cerveau, l'historique est partagé avec le mode texte.

## Gmail en direct (connexion Google)

Dans « Mes outils », la section Gmail permet de connecter un ou plusieurs comptes Google (OAuth, portée
`gmail.modify`). Les jetons sont stockés côté serveur et rafraîchis automatiquement. L'assistant dispose alors
des outils `gmail_rechercher`, `gmail_lire`, `gmail_repondre`, `gmail_envoyer`, `gmail_brouillon` et
`gmail_comptes`. Il faut un ID client OAuth Google (type Application Web) avec l'adresse de redirection
`https://<votre-worker>/oauth/google/callback` et l'API Gmail activée ; l'ID et le secret se saisissent une fois
dans l'application (ou via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).

## Faire évoluer l'assistant depuis l'assistant (Claude Code)

Avec un secret `GITHUB_TOKEN` (jeton GitHub à granularité fine, droits Issues : lecture/écriture sur ce dépôt),
l'assistant dispose de l'outil `demander_developpement` : il ouvre une issue mentionnant `@claude`. Le workflow
`.github/workflows/claude.yml` (Claude Code GitHub Actions, secret `ANTHROPIC_API_KEY` côté GitHub, application
GitHub « Claude » installée sur le dépôt) implémente la demande et ouvre une pull request. La fusion sur `main`
redéploie le Worker via `deploy.yml`.

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
| `ANTHROPIC_WORKSPACE_ID` | Identifiant d'espace de travail, requis si la clé n'y est pas rattachée |
| `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE` | Mode conversation vocale en direct (optionnel) |
| `ASSISTANT_PASSWORD`, `SESSION_SECRET` | Accès et signature du cookie de session (obligatoires) |
| `CLAUDE_MODEL`, `CLAUDE_EFFORT` | Modèle (`claude-opus-5-5`) et effort (`low`…`max`, défaut `medium`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Notifications push (`npm run vapid`) |
| `TRANSCRIBE_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | Service de transcription des vocaux enregistrés (API multipart compatible `/v1/audio/transcriptions`) |
| `ASSISTANT_NAME`, `USER_NAME` | Nom de l'assistant et prénom de l'utilisateur dans le prompt |
| `PORT`, `DATA_DIR`, `MCP_CONFIG` | Port, dossier des données, chemin du fichier MCP (Node) |
| `MCP_CONFIG_JSON` | Configuration MCP en JSON inline (prioritaire sur le fichier ; seule option sur Cloudflare) |

## Déploiement sur Cloudflare Workers

L'application tourne aussi sur Cloudflare Workers (`wrangler.jsonc`) : données dans KV, fichiers statiques en
assets, rappels livrés par un cron chaque minute, notifications push via WebCrypto.

**Déploiement automatique à chaque push sur `main`** (`.github/workflows/deploy.yml`) dès que ces secrets
GitHub existent (Settings → Secrets and variables → Actions) :

| Secret GitHub | Rôle |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Jeton API Cloudflare avec le modèle « Edit Cloudflare Workers » |
| `CLOUDFLARE_ACCOUNT_ID` | Identifiant du compte (Dashboard → Workers & Pages, colonne de droite) |
| `ANTHROPIC_API_KEY`, `ASSISTANT_PASSWORD`, `SESSION_SECRET` | Copiés comme secrets du Worker (obligatoires) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Notifications push (`npm run vapid`) |
| `MCP_CONFIG_JSON` | Contenu de `mcp.config.json` sur une ligne (les jetons peuvent être inclus en `authorization_token`) |
| `TRANSCRIBE_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | Transcription des vocaux (optionnel) |

Le Worker est ensuite joignable sur `https://assistant-vocal.<votre-sous-domaine>.workers.dev`.

**Déploiement manuel** depuis un poste connecté à Cloudflare :

```bash
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY     # idem ASSISTANT_PASSWORD, SESSION_SECRET, VAPID_*, MCP_CONFIG_JSON
npm run deploy
```

Sur Cloudflare, la configuration MCP vient de secrets (pas de fichier). Le plus simple : un secret `MCP_URL_<NOM>`
par serveur (ex. `MCP_URL_ZAPIER` avec l'URL du serveur MCP Zapier), avec en option `MCP_TOKEN_<NOM>`,
`MCP_DESC_<NOM>` et `MCP_TOOLS_<NOM>` (liste blanche séparée par des virgules). Sinon, `MCP_CONFIG_JSON`. Les jetons des
serveurs MCP peuvent y être écrits directement (`authorization_token`) ou référencer d'autres secrets du
Worker via `authorization_token_env`.

## Tests

```bash
npm test
```

Les tests couvrent l'authentification, l'analyse de la configuration MCP, la boucle de conversation
(outils locaux, blocs MCP rejoués, fallback filtré), le flux SSE, le backend KV et le chiffrement des
notifications push, avec un client Anthropic simulé.
