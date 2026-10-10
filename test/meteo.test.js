import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocoder, previsions, resumerJour, resumerTranches, conseil, texteMeteo, executerOutilMeteo, libelleWMO, direction, interpreterQuand, jourEnLettres, cleGeo, clePrevisions, normaliserNom, definitionOutilMeteo, DUREE_CACHE_MS } from '../server/meteo.js';
import { outilsLocauxDisponibles, nomsOutilsLocaux, executerOutilLocal } from '../server/tools.js';
import { modifierReglages } from '../server/reglages.js';
import { definirPositionCourante } from '../server/trajets.js';
import { ecrireValeur, lireValeur, supprimerValeur } from '../server/store.js';
import { genererBrief } from '../server/brief.js';
import { construirePromptSysteme } from '../server/prompt.js';

const DOMICILE = '12 rue des Lilas, 83000 Toulon';
const MAINTENANT = new Date('2026-10-10T07:00:00Z'); // samedi 10 octobre, 9 h à Paris
const JOURS = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];

// Prévisions simulées : `horaire(jour, heure)` et `quotidien(jour)` permettent de personnaliser chaque valeur.
function previsionsSimulees({ horaire = () => ({}), quotidien = () => ({}) } = {}) {
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [] };
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [], wind_speed_10m_max: [], wind_gusts_10m_max: [], wind_direction_10m_dominant: [], sunrise: [], sunset: [] };
  JOURS.forEach((jour, j) => {
    for (let h = 0; h < 24; h++) {
      const v = { temperature: 15, probabilite: 0, pluie: 0, code: 0, vent: 10, rafales: 15, ...horaire(j, h) };
      hourly.time.push(`${jour}T${String(h).padStart(2, '0')}:00`);
      hourly.temperature_2m.push(v.temperature); hourly.precipitation_probability.push(v.probabilite); hourly.precipitation.push(v.pluie);
      hourly.weather_code.push(v.code); hourly.wind_speed_10m.push(v.vent); hourly.wind_gusts_10m.push(v.rafales);
    }
    const q = { code: 0, tMax: 19, tMin: 12, pluie: 0, probabilite: 0, vent: 20, rafales: 30, direction: 135, ...quotidien(j) };
    daily.time.push(jour); daily.weather_code.push(q.code); daily.temperature_2m_max.push(q.tMax); daily.temperature_2m_min.push(q.tMin);
    daily.precipitation_sum.push(q.pluie); daily.precipitation_probability_max.push(q.probabilite); daily.wind_speed_10m_max.push(q.vent); daily.wind_gusts_10m_max.push(q.rafales);
    daily.wind_direction_10m_dominant.push(q.direction); daily.sunrise.push(`${jour}T07:40`); daily.sunset.push(`${jour}T18:55`);
  });
  return { latitude: 43.12, longitude: 5.93, timezone: 'Europe/Paris', hourly, daily };
}

// Open-Meteo simulé (géocodage + prévisions) avec journal des URL appelées.
function openMeteoSimule(journal, { previsions: prev = previsionsSimulees(), lieux = {} } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    journal.push(u.toString());
    if (u.hostname === 'geocoding-api.open-meteo.com') {
      const nom = u.searchParams.get('name');
      assert.equal(u.searchParams.get('language'), 'fr'); assert.equal(u.searchParams.get('count'), '1');
      const l = lieux[nom] ?? (/^toulon$/i.test(nom) ? { name: 'Toulon', latitude: 43.1242, longitude: 5.928, admin1: 'Provence-Alpes-Côte d’Azur', country: 'France' } : /^marseille$/i.test(nom) ? { name: 'Marseille', latitude: 43.2965, longitude: 5.3698, admin1: 'Provence-Alpes-Côte d’Azur', country: 'France' } : null);
      return new Response(JSON.stringify(l ? { results: [l] } : {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.hostname === 'api.open-meteo.com') {
      assert.equal(u.searchParams.get('timezone'), 'Europe/Paris'); assert.equal(u.searchParams.get('models'), 'best_match'); assert.equal(u.searchParams.get('forecast_days'), '7');
      assert.match(u.searchParams.get('hourly'), /temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m/);
      assert.match(u.searchParams.get('daily'), /weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max/);
      return new Response(JSON.stringify(prev), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ reason: `inattendu ${u}` }), { status: 500 });
  };
}

async function viderCaches() {
  for (const cle of ['geo:toulon', 'geo:marseille', cleGeo(DOMICILE), clePrevisions(43.1242, 5.928), clePrevisions(43.2965, 5.3698), clePrevisions(43.1, 5.9), 'geo:nulle-part']) await supprimerValeur(cle).catch(() => {});
  await ecrireValeur('reglages', {}); definirPositionCourante(null);
}

test('geocoder : appel Open-Meteo en français, cache dans le store (second appel sans fetch), adresse postale → ville, lieu introuvable', async () => {
  await viderCaches();
  const journal = []; const f = openMeteoSimule(journal);
  const l = await geocoder('Toulon', f);
  assert.deepEqual({ nom: l.nom, lat: l.lat, lng: l.lng }, { nom: 'Toulon', lat: 43.1242, lng: 5.928 });
  assert.equal(journal.length, 1); assert.match(journal[0], /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Toulon/);
  assert.deepEqual(await lireValeur('geo:toulon'), l, 'mis en cache sous geo:<nom normalisé>');
  const l2 = await geocoder('toulon ', f);
  assert.deepEqual(l2, l); assert.equal(journal.length, 1, 'second appel servi par le cache');
  assert.equal(normaliserNom('Saint-Étienne du Rouvray'), 'saint-etienne-du-rouvray');
  // Adresse postale : la recherche sur le texte complet échoue, repli sur la ville après le code postal.
  const d = await geocoder(DOMICILE, f);
  assert.equal(d.nom, 'Toulon'); assert.equal(journal.length, 3);
  assert.ok(journal[1].includes('name=12+rue+des+Lilas') && journal[2].includes('name=Toulon'));
  assert.deepEqual(await lireValeur(cleGeo(DOMICILE)), d);
  await assert.rejects(() => geocoder('Nulle part', f), /Lieu introuvable : Nulle part/);
  await assert.rejects(() => geocoder('', f), /Lieu manquant/);
});

test('previsions : paramètres Open-Meteo, cache 30 min par lieu (clé meteo:<lat>_<lng> arrondis), expiration', async () => {
  await viderCaches();
  const journal = []; const f = openMeteoSimule(journal);
  const p = await previsions({ lat: 43.12419, lng: 5.92801 }, f, MAINTENANT);
  assert.equal(p.daily.time.length, 7); assert.equal(journal.length, 1);
  assert.match(journal[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=43\.1242&longitude=5\.928&/);
  assert.equal(clePrevisions(43.12419, 5.92801), 'meteo:43-12_5-93'); assert.equal(clePrevisions(-33.9, -70.65), 'meteo:m33-90_m70-65');
  assert.ok(await lireValeur('meteo:43-12_5-93'));
  await previsions({ lat: 43.1242, lng: 5.928 }, f, new Date(MAINTENANT.getTime() + 10 * 60_000));
  assert.equal(journal.length, 1, 'dix minutes plus tard : cache');
  await previsions({ lat: 43.1242, lng: 5.928 }, f, new Date(MAINTENANT.getTime() + DUREE_CACHE_MS + 1000));
  assert.equal(journal.length, 2, 'après 30 min : nouvel appel');
  await assert.rejects(() => previsions({ lat: 'x', lng: 5 }, f), /Coordonnées invalides/);
  const casse = async () => new Response(JSON.stringify({ error: true, reason: 'Invalid parameters' }), { status: 400 });
  await assert.rejects(() => previsions({ lat: 1, lng: 1 }, casse), /Open-Meteo : Invalid parameters/);
});

test('rendu : codes WMO en français, direction du vent, jour en lettres, quand', () => {
  assert.equal(libelleWMO(0), 'ensoleillé'); assert.equal(libelleWMO(0, { nuit: true }), 'ciel dégagé');
  assert.equal(libelleWMO(3), 'ciel couvert'); assert.equal(libelleWMO(45), 'brouillard');
  assert.equal(libelleWMO(61), 'pluie faible'); assert.equal(libelleWMO(65), 'pluie forte'); assert.equal(libelleWMO(71), 'neige faible');
  assert.equal(libelleWMO(80), 'averses faibles'); assert.equal(libelleWMO(95), 'orage'); assert.equal(libelleWMO(99), 'orage avec forte grêle');
  assert.equal(libelleWMO(null), 'temps indéterminé'); assert.equal(libelleWMO(42), 'temps indéterminé');
  assert.equal(direction(135), 'sud-est'); assert.equal(direction(0), 'nord'); assert.equal(direction(350), 'nord'); assert.equal(direction(270), 'ouest');
  assert.equal(jourEnLettres('2026-10-15'), 'jeudi 15 octobre'); assert.equal(jourEnLettres('2026-10-11', { mois: false }), 'dimanche 11');
  assert.equal(interpreterQuand('aujourdhui', MAINTENANT), 0); assert.equal(interpreterQuand("Aujourd'hui", MAINTENANT), 0); assert.equal(interpreterQuand('', MAINTENANT), 0);
  assert.equal(interpreterQuand('demain', MAINTENANT), 1); assert.equal(interpreterQuand('après-demain', MAINTENANT), 2); assert.equal(interpreterQuand('semaine', MAINTENANT), 'semaine');
  assert.equal(interpreterQuand('2026-10-13', MAINTENANT), 3);
  assert.throws(() => interpreterQuand('2026-10-09', MAINTENANT), /passée/);
  assert.throws(() => interpreterQuand('2026-10-20', MAINTENANT), /trop lointaine/);
  assert.throws(() => interpreterQuand('mardi prochain', MAINTENANT), /Période inconnue : « mardi prochain »/);
});

test('resumerTranches / resumerJour / conseil : matin, après-midi, soirée ; parapluie si probabilité ≥ 50 %', () => {
  // Demain : ciel voilé le matin, averses l'après-midi (70 %, 4 mm), soirée dégagée, rafales à 55.
  const prev = previsionsSimulees({
    horaire: (j, h) => (j !== 1 ? {} : h < 12 ? { code: 2, temperature: 14 } : h < 18 ? { code: 81, probabilite: 70, pluie: 4 / 6, temperature: 19, vent: 30, rafales: 55 } : { code: 0, temperature: 16 }),
    quotidien: (j) => (j === 1 ? { code: 81, tMin: 14, tMax: 19, probabilite: 70, pluie: 4, vent: 30, rafales: 55, direction: 135 } : j === 2 ? { tMin: -1, tMax: 6 } : {}),
  });
  const t = resumerTranches(prev, 1);
  assert.deepEqual(t.map((x) => [x.cle, x.ciel, x.tMin, x.tMax, x.probabilite]), [['matin', 'partiellement nuageux', 14, 14, 0], ['apresMidi', 'averses', 19, 19, 70], ['soiree', 'ciel dégagé', 16, 16, 0]]);
  assert.equal(Math.round(t[1].pluieMm), 4); assert.equal(t[1].rafales, 55);
  const j = resumerJour(prev, 1);
  assert.deepEqual({ ciel: j.ciel, tMin: j.tMin, tMax: j.tMax, direction: j.direction, probabilite: j.probabilite }, { ciel: 'averses', tMin: 14, tMax: 19, direction: 'sud-est', probabilite: 70 });
  assert.equal(conseil(prev, 1), 'Prenez un parapluie. Attention aux rafales.');
  assert.equal(conseil(prev, 0), '', 'journée calme : aucun conseil');
  assert.equal(conseil(prev, 2), 'Gel possible : attention au verglas.');
  const seuil = previsionsSimulees({ quotidien: (j) => ({ probabilite: j === 1 ? 50 : 49 }) });
  assert.equal(conseil(seuil, 1), 'Prenez un parapluie.'); assert.equal(conseil(seuil, 2), '');
  const orage = previsionsSimulees({ horaire: (j, h) => (j === 0 && h === 15 ? { code: 95 } : {}), quotidien: (j) => (j === 0 ? { tMax: 32 } : {}) });
  assert.equal(conseil(orage, 0), 'Orages possibles : évitez les sorties en mer et en montagne. Forte chaleur : pensez à boire.');
  assert.throws(() => resumerJour(prev, 9), /Pas de prévision/);
});

test('texteMeteo : demain en tranches lisible à voix haute, aujourd\'hui sans les tranches passées, semaine une ligne par jour, date précise', async () => {
  await viderCaches();
  const prev = previsionsSimulees({
    horaire: (j, h) => (j === 0 ? (h < 12 ? { code: 61, probabilite: 80, pluie: 0.5, temperature: 12 } : { code: 1, temperature: 18 }) : j === 1 ? (h < 12 ? { code: 2, temperature: 14 } : h < 18 ? { code: 81, probabilite: 70, pluie: 4 / 6, temperature: 19, vent: 30, rafales: 55 } : { code: 0, temperature: 16 }) : {}),
    quotidien: (j) => (j === 0 ? { code: 61, tMin: 12, tMax: 18, probabilite: 80, pluie: 3 } : j === 1 ? { code: 81, tMin: 14, tMax: 19, probabilite: 70, pluie: 4, vent: 30, rafales: 55, direction: 135 } : j === 3 ? { code: 63, tMin: 11, tMax: 15, probabilite: 90, pluie: 12, vent: 45, rafales: 70, direction: 270 } : {}),
  });
  const journal = []; const f = openMeteoSimule(journal, { previsions: prev });
  assert.equal(await texteMeteo({ lieu: 'Toulon', quand: 'demain' }, f, MAINTENANT), "Demain à Toulon : partiellement nuageux le matin, averses l'après-midi (70 %, 4 mm), ciel dégagé en soirée, 14 à 19 degrés, vent de sud-est 30 km/h en rafales à 55. Prenez un parapluie. Attention aux rafales.");
  assert.equal(journal.length, 2, 'géocodage + prévisions');
  // Aujourd'hui à 9 h : la matinée (pluvieuse) est en cours, donc présente ; à 14 h, elle disparaît.
  assert.equal(await texteMeteo({ lieu: 'Toulon', quand: 'aujourdhui' }, f, MAINTENANT), "Aujourd'hui à Toulon : pluie faible le matin (80 %, 3 mm), peu nuageux l'après-midi et en soirée, 12 à 18 degrés, vent de sud-est 10 km/h. Prenez un parapluie.");
  assert.equal(await texteMeteo({ lieu: 'Toulon' }, f, new Date('2026-10-10T12:00:00Z')), "Aujourd'hui à Toulon : peu nuageux l'après-midi et en soirée, 18 degrés, vent de sud-est 10 km/h. Prenez un parapluie.");
  assert.equal(journal.length, 3, 'cinq heures plus tard : prévisions rafraîchies');
  const semaine = await texteMeteo({ lieu: 'Toulon', quand: 'semaine' }, f, MAINTENANT);
  const lignes = semaine.split('\n');
  assert.equal(lignes[0], 'Semaine à Toulon :'); assert.equal(lignes.length, 8);
  assert.equal(lignes[1], 'Samedi 10 : pluie faible, 12 à 18 degrés, pluie 80 % (3 mm).');
  assert.equal(lignes[2], 'Dimanche 11 : averses, 14 à 19 degrés, pluie 70 % (4 mm), vent 30 km/h en rafales à 55.');
  assert.equal(lignes[3], 'Lundi 12 : ensoleillé, 12 à 19 degrés.');
  assert.equal(lignes[4], 'Mardi 13 : pluie modérée, 11 à 15 degrés, pluie 90 % (12 mm), vent 45 km/h en rafales à 70.');
  assert.equal(await texteMeteo({ lieu: 'Toulon', quand: '2026-10-13' }, f, MAINTENANT), 'Mardi 13 octobre à Toulon : pluie modérée, 11 à 15 degrés, pluie 90 % (12 mm), vent 45 km/h en rafales à 70. Prenez un parapluie. Vent violent : attachez ce qui peut s\'envoler.');
  assert.equal(await texteMeteo({ lieu: 'Toulon', quand: '2026-10-12' }, f, MAINTENANT), 'Lundi 12 octobre à Toulon : ensoleillé, 12 à 19 degrés.');
});

test('outil meteo : sans lieu → position courante, sinon domicile géocodé, sinon Toulon ; quand invalide → message clair ; non strict', async () => {
  await viderCaches();
  const journal = []; const f = openMeteoSimule(journal);
  assert.ok(nomsOutilsLocaux.has('meteo'));
  const o = (await outilsLocauxDisponibles()).find((t) => t.name === 'meteo');
  assert.ok(o && !o.strict && !o.defer_loading, 'meteo présent, non strict, chargé d\'emblée');
  assert.equal(definitionOutilMeteo.input_schema.required, undefined);
  // Ni position ni domicile : Toulon.
  assert.match(await executerOutilMeteo({}, f, MAINTENANT), /^Aujourd'hui à Toulon : ensoleillé toute la journée, 15 degrés, vent de sud-est 10 km\/h\.$/);
  assert.ok(journal[0].includes('name=Toulon'));
  // Domicile enregistré : géocodé via la ville de l'adresse.
  await modifierReglages({ domicile: DOMICILE }); journal.length = 0;
  assert.match(await executerOutilMeteo({ lieu: '', quand: 'demain' }, f, MAINTENANT), /^Demain à Toulon : ensoleillé toute la journée, 15 degrés/);
  assert.ok(journal.some((u) => u.includes('geocoding-api') && u.includes('name=12+rue')), 'adresse du domicile géocodée');
  assert.match(await executerOutilMeteo({ lieu: 'domicile' }, f, MAINTENANT), /^Aujourd'hui à la maison :/);
  // Position partagée : prioritaire sur le domicile, sans géocodage.
  definirPositionCourante({ lat: 43.1, lng: 5.9 }); journal.length = 0;
  assert.match(await executerOutilMeteo({ lieu: '' }, f, MAINTENANT), /^Aujourd'hui à votre position :/);
  assert.equal(journal.length, 1); assert.match(journal[0], /latitude=43\.1&longitude=5\.9&/);
  // Lieu explicite : géocodé, position ignorée.
  assert.match(await executerOutilMeteo({ lieu: 'Marseille', quand: 'demain' }, f, MAINTENANT), /^Demain à Marseille :/);
  // Erreurs lisibles, jamais d'exception.
  assert.equal(await executerOutilMeteo({ quand: 'la semaine prochaine' }, f, MAINTENANT), 'Météo indisponible : Période inconnue : « la semaine prochaine ». Utilise aujourdhui, demain, semaine ou une date AAAA-MM-JJ.');
  assert.equal(await executerOutilMeteo({ lieu: 'Nulle part' }, f, MAINTENANT), 'Météo indisponible : Lieu introuvable : Nulle part');
  assert.match(await executerOutilMeteo({ quand: '2026-10-01' }, f, MAINTENANT), /^Météo indisponible : La date 2026-10-01 est passée/);
  // Branchement dans executerOutilLocal (fetch réel non appelé : cache des prévisions à la position courante).
  assert.match(await executerOutilLocal('meteo', { lieu: '', quand: 'aujourdhui' }), /à votre position :/);
  definirPositionCourante(null);
});

test('prompt et brief : la carte des outils décrit meteo ; la consigne du brief commence par la météo', async () => {
  const prompt = construirePromptSysteme([], {});
  const texte = Array.isArray(prompt) ? prompt.map((b) => b.text || '').join('\n') : String(prompt);
  assert.match(texte, /- meteo : prévisions aujourd'hui, demain, semaine ou date/);
  const requetes = [];
  const client = { beta: { messages: { stream(params) {
    requetes.push(structuredClone(params));
    const reponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Brief avec météo.' }] };
    return { async *[Symbol.asyncIterator]() { yield { type: 'content_block_start', content_block: reponse.content[0] }; yield { type: 'content_block_delta', delta: { type: 'text_delta', text: reponse.content[0].text } }; }, async finalMessage() { return reponse; } };
  } } } };
  await genererBrief({ client, serveurs: [] });
  const consigne = requetes[0].messages.at(-1).content;
  assert.match(consigne, /1\) Appelle l'outil meteo \(lieu vide, quand = aujourdhui\)/);
  assert.match(consigne, /date du jour en toutes lettres puis une phrase météo du jour/);
});
