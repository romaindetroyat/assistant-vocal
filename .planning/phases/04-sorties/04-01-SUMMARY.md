# Summary 04-01 — Sorties : voix, notifications, rappels

**Status**: Complete · **Requirements**: OUT-01..04 · **Date**: 2026-10-07

## What was built

speechSynthesis fr-FR + mode conversation (réécoute après réponse), Web Push VAPID, outils notify_me / schedule_reminder / list_reminders / cancel_reminder, planificateur 20 s.

## Files

public/app.js, server/push.js, server/tools.js, server/scheduler.js, server/vapid.js

## Verification

test/chat.test.js (outil local) ; push à vérifier avec clés VAPID réelles

## Notes

Développé sans clé API dans l'environnement : la boucle Claude est testée avec un client simulé ;
la validation de bout en bout (vrai modèle, vrais serveurs MCP) reste à faire par Romain.
