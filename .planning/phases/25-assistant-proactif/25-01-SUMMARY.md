# Phase 25 — Résumé

## Livré
- **`server/proactif.js`**, appelé chaque minute par le cron du Worker et le planificateur Node (`tachesProactives`) :
  - **Mails urgents** : toutes les 15 min hors silence, non-lus récents de chaque boîte (hors promotions, réseaux, forums ;
    en-têtes et extrait seulement), tri par Haiku 5.5 (effort bas, consigne anti-injection), au plus 3 push par passage
    « Mail urgent — Expéditeur : objet — raison » ; identifiants mémorisés (500 derniers) : jamais deux fois le même mail.
  - **Rendez-vous** : à partir de 7 h, une fois par jour, liste JSON des rendez-vous horodatés (tour éphémère sur l'agenda),
    rappel « Dans 10 min : … » pour chacun, sauf ceux à adresse physique quand la clé Routes donne déjà « Partez pour … ».
  - **Résumé du soir** : à l'heure choisie (18 h 30 par défaut), une fois par jour : fait, reste à faire, demain (et départ) ;
    push « Votre soirée », texte conservé et relu par le nouvel outil local `resume_du_soir`.
  - **Heures de silence** (21 h → 7 h par défaut, à cheval sur minuit) : aucun mail urgent ni résumé pendant ce temps.
- **Réglages** : bloc `proactif` validé (interrupteurs, heures HH:MM, fusion partielle) ; section « Assistant proactif » dans
  Mes outils avec l'état des derniers passages (`GET /api/proactif/etat`).
- Mode voiture : les notifications sont déjà lues à voix haute (phase 19).

## Tests
114 verts (`test/proactif.test.js` : silence, validation, tri et déduplication des mails, rappels de rendez-vous sans doublon,
résumé du soir une fois par jour et outil).

## Coût estimé
Tri des mails ≈ 0,01 ct par passage (Haiku) ; rendez-vous et résumé du soir : deux tours par jour au modèle par défaut.
