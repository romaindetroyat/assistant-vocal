# Summary 15-02 — Mains libres fiable sur iPhone
**Status**: Complete · **Requirements**: IN-07 · **Date**: 2026-10-10
## What was built
- Transcription sans configuration supplémentaire : `transcribe.js` se rabat sur OpenAI `gpt-4o-mini-transcribe`
  avec la clé du mode conversation ; le bouton « vocal » devient disponible ; `indice` guide la transcription.
- Veille à deux moteurs : SpeechRecognition (Chrome) ou écoute locale (iPhone, Safari, repli après 5 échecs) :
  détection de voix par niveau sonore (plancher de bruit adaptatif), extrait de 0,25 à 3 s via MediaRecorder
  (`audio/mp4` sur iOS), transcription serveur, comparaison tolérante au mot d'activation.
- Micro et élément audio conservés entre appel et veille (pas de nouvelle permission, lecture autorisée sans geste),
  contexte Web Audio créé au clic d'appel, wake lock écran pendant la veille, 60 extraits maximum par veille.
## Limits
- Sur iPhone, la veille exige l'app ouverte à l'écran (pas d'écoute écran verrouillé ni en arrière-plan : limite iOS).
- Chaque extrait coûte une transcription courte (quelques centimes par heure de veille bruyante au maximum).
