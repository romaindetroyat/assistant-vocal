# Tâche rapide — Question rugby mal traitée : modèle intermédiaire pour chercher une information

## Constat (journal de la conversation, lecture seule)
« Le résultat du match de Toulon rugby hier soir » (voix) → mode auto → Haiku (« question simple ») → recherche web de base
→ « je n'ai pas trouvé le score ». Ovalie n'est pas branché dans l'app (serveurs : agenda, matrix, granola, vercel, supabase,
cloudflare, netlify) : seul le Claude de la session de développement y a accès.

## Fait
- `routage.js` : troisième palier : information à chercher (sport, résultats, actualité, prix, horaires, qui est…) → Sonnet 5.5,
  dont la recherche web filtre les résultats ; Haiku garde les outils personnels, Opus les tâches.
- `prompt.js` : un serveur spécialisé (sport, réunions, dictaphone…) passe avant la recherche web.
- Test : quatre questions de ce type routées vers Sonnet. Cache SW v43.

## Reste
- Brancher Ovalie dans l'app (adresse du serveur MCP à ajouter dans Mes outils, ou à me donner).
