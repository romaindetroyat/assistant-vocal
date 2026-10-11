# Phase 24 — Résumé

## Livré
- **Mode automatique** (`modele: 'auto'`, nouveau défaut, bouton « Auto » du dock et option des Réglages) : à chaque demande
  (chat, voix, Siri, partage), règles instantanées dans `server/routage.js` : pièce jointe, demande longue (> 280 caractères)
  ou mot de tâche (rédige, réponds, envoie, analyse, compare, conseil, idées, document…) → Opus 5.5 ; sinon Haiku 5.5.
  Brief, documents, consolidation et compaction gardent le modèle par défaut.
- **Escalade** : en mode auto, Haiku dispose de l'outil `escalader` ; s'il l'appelle, le tour repart sur Opus avec la consigne,
  sans conserver la réponse de Haiku (historique toujours append-only).
- **Visibilité** : événement SSE `modele` (étiquette « Haiku · auto » sous la réponse dans la transcription), champ `modele`
  dans `/api/voice/ask`, puce du mode voiture.
- **Consommation par modèle** : tokens et appels par modèle et par jour, coût au bon tarif (Haiku 0,10/0,50, Sonnet 2/10,
  Opus 4/20 $ par million ; cache 0,1 × / 2 ×) ; colonne « Modèles » dans Mes outils ; jours antérieurs comptés au tarif Opus.

## Tests
110 verts (`test/routage.test.js` : règles, Haiku vs Opus, escalade avec consigne rejointe, modèle forcé, coût par modèle ;
tests du chat et de la compaction adaptés au nouvel événement).

## Points d'attention
- Le réglage enregistré de Romain est « opus » (choisi auparavant) : il doit toucher « Auto » une fois pour l'activer.
- Les caches de prompt sont propres à chaque modèle : alterner Haiku et Opus réécrit un peu de cache, coût marginal.
