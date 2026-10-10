# Summary 15-01 — Mains libres et compaction
**Status**: Complete · **Requirements**: IN-07, ORC-09 · **Date**: 2026-10-10
## What was built
- `server/compaction.js` : `compacterSiNecessaire({ client, conversation })` — au-delà de 120 000 caractères
  (`COMPACTION_SEUIL`), résumé en français par Claude (effort low, 3000 tokens, sans outils) des messages anciens,
  remplacés par un échange court ; les six derniers messages restent intacts, coupure reculée jusqu'à un vrai
  message utilisateur pour ne jamais séparer tool_use et tool_result ; `conversation.resumes[]` conservé.
  Branché au début de `executerTour` (`chat.js`), événement `{ type: 'compaction', messages }` ; une erreur de
  résumé est journalisée et le tour continue sans compaction.
- Front : bloc repliable « Résumé de l'historique » en tête d'une conversation compactée, message système
  « Historique compacté » (à l'ouverture et sur l'événement SSE).
- `server/reglages.js` : `mainsLibres` (booléen, défaut false) et `motActivation` (2–40 caractères, minuscules,
  défaut « assistant »), exposés par `/api/reglages`, case et champ dans « Mes outils ».
- `public/conversation.js` : option `delaiInactivite()` — raccrochage automatique après 45 s sans parole ni
  réponse (temporisateur réarmé par les événements du canal de données, suspendu pendant la délégation à Claude).
- `public/app.js` : veille à mot d'activation après la fin d'un appel quand `mainsLibres` est actif —
  SpeechRecognition continu fr-FR, comparaison insensible à la casse et aux accents, relance via la même fonction
  que le bouton 📞 ; anti-boucle (≤ 1 redémarrage/s, arrêt après 5 échecs), jamais pendant un appel, une dictée ou
  un vocal, suspendue quand l'onglet est caché et reprise au retour ; bandeau « En veille · dites « … » » avec
  bouton « Quitter la veille » ; message si SpeechRecognition est absent. `sw.js` : cache `assistant-v15`.
## Verification
- `test/compaction.test.js` (5 tests : sous le seuil, au-dessus, coupure tool_use/tool_result, texte du résumé,
  branchement dans `executerTour` et tolérance aux erreurs) ; test réglages mains libres dans `voice.test.js`.
- `npm test` : 45 tests verts ; `node --check public/app.js public/conversation.js` et script inline de
  `outils.html` valides.
## Limites et points d'attention
- La veille n'est pas testée en navigateur réel ; SpeechRecognition sur iOS Safari exige une PWA installée ou un
  geste utilisateur récent et coupe souvent le mode `continuous` : le compteur d'échecs arrête alors la veille
  proprement. Chrome Android reste la cible la plus fiable.
- La veille commence uniquement après un appel (pas au lancement de l'app) : un premier appui sur 📞 est requis.
- Le résumé de compaction est un message `user` ordinaire pour Claude ; il est masqué dans l'historique affiché au
  profit du bloc repliable.
