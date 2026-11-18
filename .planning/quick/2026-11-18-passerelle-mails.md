# Tâche rapide — Réduire l'assistant à une passerelle Gmail multi-comptes

## Demande
« Je voudrais que cet assistant ne serve plus qu'à agglomérer les accès aux mails pour que Claude soit connecté à trois
comptes en même temps. Le reste, je m'en fous : on peut annuler les tâches automatiques et tout ce qui coûte des tokens ou
des euros. » Constat préalable : 6 questions posées en 30 jours contre plus de 500 appels automatiques (6,68 $).

## Fait (variable `MODE=mails` dans wrangler.jsonc)
- Serveur MCP (`/mcp`, utilisé par claude.ai) : seuls les outils `gmail_*` sont exposés ; `demander_assistant` (qui appelait
  Claude) et les autres outils sont retirés ; instructions du serveur réécrites.
- Routes qui appellent Claude ou OpenAI coupées (410) : chat, voix (session et délégation), Siri, partage, ajout au coffre,
  transcription, diagnostic de latence.
- Tâches automatiques arrêtées : plus de cron (brief, mails urgents, rappels de rendez-vous, résumé du soir, départs,
  consolidation de la mémoire) ; planificateur Node désactivé dans ce mode.
- Inchangé : connexion des comptes Google (Mes outils, menu), OAuth du serveur MCP pour claude.ai.
- Sans `MODE=mails`, l'application complète fonctionne comme avant (tests existants inchangés).
- Tests : `test/passerelle.test.js`. 122 verts.

## Coût restant
Aucun appel Claude ni OpenAI par l'application. L'API Gmail est gratuite. Le Worker Cloudflare reste dans l'offre gratuite.
