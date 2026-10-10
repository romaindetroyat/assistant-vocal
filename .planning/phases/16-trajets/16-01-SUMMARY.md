# Summary 16-01 — Trajets : temps de parcours, itinéraire, heure de départ
**Status**: Complete · **Requirements**: TRA-01, TRA-02, TRA-03 · **Date**: 2026-10-10
## What was built
- `server/trajets.js` : `configTrajets()` (clé saisie dans l'app `trajets-config`, sinon `GOOGLE_MAPS_API_KEY` ; jamais
  renvoyée en clair, `masquerCle` → `AIza…xxxx`), `calculerTrajet({ origine, destination, mode, departA, arriveeA })`
  via Google Routes `computeRoutes` (`X-Goog-Api-Key`, FieldMask minimal, `TRAFFIC_AWARE` en voiture, `languageCode fr-FR`,
  adresses ou coordonnées `lat,lng`) → `{ dureeMin, dureeTraficMin, distanceKm, resume, etapes, heureDepart, lienPlans,
  lienGoogle }` ; `heureDepart` : en voiture deux appels (sans trafic pour estimer le départ, puis trafic prévu à cette
  heure), marge de 5 min ; en transports `arrivalTime` ; `formaterTrajet` lisible à voix haute avec deux lignes
  `Plans : <url>` / `Google Maps : <url>` ; `sansLiensItineraire` pour la voix.
- Origine par défaut : position courante (`definirPositionCourante`, mise à jour par les routes) sinon domicile ;
  alias « domicile », « bureau », « maison », « travail » résolus depuis les réglages.
- Outils locaux non stricts `trajet_calculer` et `trajet_adresse_definir` (branchés dans `tools.js`, décrits dans
  `prompt.js`) ; sans clé, `trajet_calculer` renvoie un message demandant la saisie dans « Mes outils › Trajets ».
- Réglages (`reglages.js`) : `domicile`, `bureau` (≤ 200 caractères), `partagerPosition` (booléen).
- Routes (`app.js`) : `GET/PUT /api/trajets/config` (clé masquée, adresses, partage), `POST /api/trajets` (calcul
  direct) ; `/api/chat` et `/api/voice/ask` acceptent `position: { lat, lng, precision }` → consigne du tour
  « Position actuelle de l'utilisateur : … » et origine des trajets ; la réponse vocale ne contient plus les liens.
- Brief (`brief.js`) : `tourEphemere` généralise le tour du brief ; la consigne demande l'heure de départ de chaque
  rendez-vous avec adresse (`trajet_calculer` depuis le domicile, `arriveeA` = début) quand une clé est configurée.
- Rappels de départ (`scheduler.js`) : `programmerDeparts` appelé par `pointDuMatin` (cron Cloudflare et Node) :
  à partir de 7 h Paris, une fois par jour (clé `departs-du-jour`), Claude liste les rendez-vous du jour avec adresse
  en JSON (`extraireRendezVous`), l'heure de départ est calculée avec le trafic prévu et un rappel push
  « Partez pour <titre> » (durée, heure d'arrivée, lien Plans) est programmé par événement, sans doublon.
- Front : section « Trajets » dans `outils.html` (clé masquée + enregistrement, domicile, bureau, « Partager ma
  position ») ; `app.js` : `obtenirPosition()` (`navigator.geolocation`, cache 5 min, échec silencieux) jointe à
  `/api/chat` et, via `apiAvecPosition`, à `/api/voice/ask` ; les lignes « Plans : … » / « Google Maps : … »
  deviennent des boutons `btn-itineraire` (`target=_blank rel=noopener`) et ne sont pas lues ; `sw.js` cache v18.
## Verification
`test/trajets.test.js` (8 tests : outil sans clé, config/masquage/adresses/position, parsing Routes et liens, heure de
départ voiture/transports, routes HTTP, position dans la consigne et voix sans liens, consigne du brief,
`programmerDeparts` unique par événement) ; `npm test` : 65 tests verts, aucune requête réseau ; `node --check
public/app.js` OK. Outils stricts inchangés.
## Limits
- La clé doit être créée par Romain dans Google Cloud (API Routes activée, clé restreinte) et collée dans l'app ;
  sans elle, l'assistant explique quoi faire et le brief / les rappels de départ ignorent les trajets.
- Les rappels de départ supposent un départ depuis le domicile en voiture ; la position partagée n'est connue que
  pendant l'usage de l'app (pas en cron). Un rendez-vous dont l'heure de départ est déjà passée à 7 h n'est pas rappelé.
- La liste des rendez-vous est demandée à Claude en JSON (un tour éphémère par matin) : un identifiant d'événement absent
  est remplacé par `debut-titre` pour la déduplication.
- Les liens d'itinéraire sont retirés des réponses vocales (GPT-Realtime) : en mode conversation, pas de bouton ;
  en mode texte, le lien Plans ouvre l'app Plans sur iPhone, Google Maps l'app ou le site selon l'appareil.
- Position : `navigator.geolocation` exige HTTPS et l'accord du navigateur ; iOS redemande l'autorisation par site.
