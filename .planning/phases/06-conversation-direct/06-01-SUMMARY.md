# Summary 06-01 — Conversation en direct
**Status**: Complete · **Requirements**: IN-06, ORC-08 · **Date**: 2026-10-08
## What was built
- `server/voice.js` : jeton éphémère OpenAI, configuration de session (modèle `gpt-realtime-2.1-mini`, voix, VAD sémantique, transcription), outil `demander_assistant`
- `public/conversation.js` : WebRTC, data channel, délégation à `/api/voice/ask`, tolérance aux coupures, reconnexion (4 essais), rejeu des réponses
- Réglages (`server/reglages.js`) : voix (10, aperçu audio en cache) et concision (très court / court / normal), consigne injectée à Claude en message système de milieu de conversation
- Effort `low` pour la voix (`CLAUDE_EFFORT_VOICE`)
## Verification
Tests voice.test.js ; session réelle créée ; test terrain : coupure WebRTC résolue par la reconnexion.
