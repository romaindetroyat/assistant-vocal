# Summary 20-01 — Météo : prévisions lisibles à voix haute (Open-Meteo, modèles ECMWF et AROME)
**Status**: Complete · **Requirements**: MET-01, MET-02 · **Date**: 2026-10-10
## What was built
- `server/meteo.js` : `geocoder(nom, fetchImpl)` via `geocoding-api.open-meteo.com/v1/search` (`language=fr`, `count=1`),
  résultat `{ nom, lat, lng, region, pays }` mis en cache définitivement dans le store (clé `geo:<nom normalisé [a-z0-9-]>`) ;
  pour une adresse postale (le domicile), repli sur la ville après le code postal puis sur le dernier segment de l'adresse.
- `previsions({ lat, lng }, fetchImpl, maintenant)` : `api.open-meteo.com/v1/forecast` avec `hourly=temperature_2m,
  precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m`, `daily=weather_code,
  temperature_2m_max/min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,
  wind_direction_10m_dominant,sunrise,sunset`, `timezone=Europe/Paris`, `forecast_days=7`, `models=best_match`
  (AROME France HD puis ECMWF IFS, comme tameteo.com / Meteored). Cache de trente minutes par lieu dans le store :
  clé `meteo:<lat>_<lng>` à deux décimales, encodée `43-12_5-93` (les clés du store n'admettent que `[a-z0-9:_-]`),
  invalidée aussi au changement de jour.
- Rendu : `LIBELLES_WMO` / `libelleWMO` (0 → ensoleillé, ou « ciel dégagé » le soir ; 61 → pluie faible ; 95 → orage…),
  `direction` (huit points cardinaux), `jourEnLettres`, `resumerTranches(prev, index)` (matin 6–12 h, après-midi 12–18 h,
  soirée 18–24 h : code le plus marqué, températures, probabilité max, cumul, vent, rafales), `resumerJour`, `conseil`
  (parapluie dès 50 % ou ≥ 1 mm, rafales ≥ 50 / ≥ 70 km/h, chaleur ≥ 30°, gel ≤ 0°, neige, orage), `texteJourDetaille`
  (« Demain à Toulon : partiellement nuageux le matin, averses l'après-midi (70 %, 4 mm), ciel dégagé en soirée, 14 à
  19 degrés, vent de sud-est 30 km/h en rafales à 55. Prenez un parapluie. Attention aux rafales. » ; aujourd'hui, les
  tranches déjà passées sont omises ; tranches de même code fusionnées, « toute la journée » si les trois), `ligneJour`
  (« Mardi 13 : pluie modérée, 11 à 15 degrés, pluie 90 % (12 mm), vent 45 km/h en rafales à 70. »).
- `texteMeteo({ lieu, quand })` : `quand` = aujourdhui (défaut), demain, après-demain, semaine (une ligne par jour, jour
  en toutes lettres) ou AAAA-MM-JJ dans les sept jours (jour en tranches si J ou J+1, sinon résumé quotidien + conseil) ;
  date passée, trop lointaine ou période inconnue → erreur explicite. Lieu : texte géocodé ; « domicile » → adresse des
  réglages (« à la maison ») ; vide ou « ici » → position partagée (`lirePositionCourante` de `trajets.js`, « à votre
  position », sans géocodage), sinon domicile géocodé, sinon Toulon.
- Outil local `meteo` (non strict, aucun champ obligatoire, chargé d'emblée) : `executerOutilMeteo` ne lève jamais
  d'exception (« Météo indisponible : … »). Branché dans `tools.js` (`nomsOutilsLocaux`, `outilsLocauxDisponibles`,
  `executerOutilLocal`) et décrit dans la carte du prompt (`prompt.js`) : lire la réponse telle quelle, sans liste.
- `brief.js` : la consigne de `genererBrief` commence par « Appelle l'outil meteo (lieu vide, quand = aujourdhui) » et le
  brief enchaîne la date puis une phrase météo du jour.
## Verification
`test/meteo.test.js` (7 tests, Open-Meteo simulé par `fetch` injecté, aucune requête réseau) : géocodage et cache (second
appel sans fetch), adresse postale → ville, lieu introuvable ; paramètres de l'appel prévisions et cache de trente minutes
avec expiration ; codes WMO, directions, jours en lettres, `quand` (dates passées / lointaines / inconnues) ; tranches,
résumé du jour et conseils (seuil 50 %, rafales, gel, orage, chaleur) ; textes complets (demain, aujourd'hui à 9 h et à
14 h, semaine, date précise) ; outil sans lieu (Toulon, domicile géocodé, position partagée prioritaire), erreurs lisibles,
non strict, branchement `executerOutilLocal` ; carte du prompt et consigne du brief. `npm test` : 86 tests verts
(79 + 7). Aucun fichier statique modifié (cache SW inchangé, v28).
## Limits
- Open-Meteo n'est pas Meteored : mêmes modèles (ECMWF IFS, AROME) mais pas la post-production de tameteo.com ; l'API
  Meteored pourra être ajoutée en option si Romain obtient une clé et la documentation.
- Pas de géocodage inverse : avec la position partagée, le texte dit « à votre position » ; le domicile est géocodé par
  sa ville (précision communale, suffisante pour la météo). Le géocodeur Open-Meteo ne connaît que les localités : un
  nom ambigu renvoie le premier résultat mondial (« Paris » = Paris, France ; « Valence » peut donner l'Espagne).
- Les tranches reposent sur le code WMO le plus élevé de la plage (phénomène le plus marquant) et la probabilité maximale,
  pas sur une durée de pluie ; la quantité est le cumul de la tranche.
- Cache des prévisions en mémoire du store (fichier ou KV) : jusqu'à trente minutes de décalage avec le site, et les
  clés `meteo:*` ne sont pas purgées (une par lieu consulté, taille négligeable). Les géocodages sont conservés sans
  expiration.
- Le brief du matin s'appuie sur la position connue par le serveur en cron (jamais partagée à ce moment-là) : la météo
  du brief est donc celle du domicile, ou de Toulon si aucune adresse n'est enregistrée.
- Pas de prévision horaire au-delà de J+1 ni d'alertes vigilance Météo-France ; horizon limité à sept jours.
