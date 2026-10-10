import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chercherLieux, formaterLieux, executerOutilLieux, definitionOutilLieux, centreRecherche } from '../server/lieux.js';
import { enregistrerConfigTrajets, retirerConfigTrajets, definirPositionCourante } from '../server/trajets.js';
import { outilsLocauxDisponibles, nomsOutilsLocaux } from '../server/tools.js';
import { construirePromptSysteme } from '../server/prompt.js';

const reponsePlaces = { places: [
  { id: 'a', displayName: { text: 'Pizzeria Chez Gino' }, formattedAddress: '12 rue des Arts, 83000 Toulon', rating: 4.9, userRatingCount: 3, priceLevel: 'PRICE_LEVEL_MODERATE', currentOpeningHours: { openNow: true }, location: { latitude: 43.12, longitude: 5.93 }, googleMapsUri: 'https://maps.google.com/?cid=1', primaryTypeDisplayName: { text: 'Pizzeria' } },
  { id: 'b', displayName: { text: 'La Bella Napoli' }, formattedAddress: '3 place Puget, 83000 Toulon', rating: 4.6, userRatingCount: 420, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', currentOpeningHours: { openNow: false }, location: { latitude: 43.13, longitude: 5.94 }, googleMapsUri: 'https://maps.google.com/?cid=2', nationalPhoneNumber: '04 94 00 00 00' },
] };

test('lieux : sans clé → message ; avec clé → requête Places, tri par note pondérée, texte lisible et liens', async () => {
  await retirerConfigTrajets();
  await assert.rejects(() => chercherLieux({ requete: 'pizzeria' }), /n'est pas configurée/);
  await enregistrerConfigTrajets({ cle: 'AIzaSyTESTtesttesttesttesttesttest1234' });
  definirPositionCourante({ lat: 43.1, lng: 5.9, precision: 20 });
  const appels = [];
  const fetchImpl = async (url, options) => { appels.push({ url, options }); return { ok: true, json: async () => reponsePlaces }; };
  const r = await chercherLieux({ requete: 'pizzeria', ouvertMaintenant: true, noteMin: 4, nombre: 3 }, fetchImpl);
  assert.equal(appels[0].url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(appels[0].options.headers['X-Goog-Api-Key'], 'AIzaSyTESTtesttesttesttesttesttest1234');
  const corps = JSON.parse(appels[0].options.body);
  assert.equal(corps.textQuery, 'pizzeria'); assert.equal(corps.openNow, true); assert.equal(corps.minRating, 4); assert.equal(corps.languageCode, 'fr');
  assert.deepEqual(corps.locationBias.circle.center, { latitude: 43.1, longitude: 5.9 });
  assert.equal(r.centre.nom, 'votre position');
  // 4,6 sur 420 avis passe devant 4,9 sur 3 avis
  assert.deepEqual(r.lieux.map((l) => l.nom), ['La Bella Napoli', 'Pizzeria Chez Gino']);
  const texte = formaterLieux(r, 'pizzeria');
  assert.match(texte, /2 bonnes adresses près de votre position/);
  assert.match(texte, /1\. La Bella Napoli, 4,6 sur 5 \(420 avis\), €, fermé en ce moment\. 3 place Puget, 83000 Toulon, 04 94 00 00 00\./);
  assert.match(texte, /Plans : https:\/\/maps\.apple\.com\/\?q=La%20Bella%20Napoli&ll=43\.13,5\.94/);
  assert.match(texte, /Google Maps : https:\/\/maps\.google\.com\/\?cid=2/);
  // Outil : erreur API lisible, requête vide refusée, aucun résultat
  assert.match(await executerOutilLieux({ requete: 'pizzeria', nombre: 1 }, fetchImpl), /Meilleure adresse/);
  await assert.rejects(() => executerOutilLieux({ requete: '' }, fetchImpl), /Précise/);
  const vide = async () => ({ ok: true, json: async () => ({ places: [] }) });
  assert.match(await executerOutilLieux({ requete: 'sushi' }, vide), /Je ne trouve pas de sushi/);
  const erreur = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Places API (New) has not been used' } }) });
  await assert.rejects(() => executerOutilLieux({ requete: 'sushi' }, erreur), /Google Places : Places API \(New\)/);
  definirPositionCourante(null);
  await retirerConfigTrajets();
});

test('lieux : centre de recherche par ville géocodée ; outil déclaré, non strict, dans le prompt', async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => (String(url).includes('geocoding') ? { results: [{ name: 'Marseille', latitude: 43.3, longitude: 5.37, admin1: 'PACA', country: 'France' }] } : { places: [] }) });
  const c = await centreRecherche('Marseille', fetchImpl);
  assert.equal(c.lat, 43.3); assert.match(c.nom, /Marseille/);
  assert.ok(nomsOutilsLocaux.has('lieux_chercher'));
  const outil = (await outilsLocauxDisponibles()).find((t) => t.name === 'lieux_chercher');
  assert.ok(outil && !outil.strict && outil.input_schema.required.includes('requete'));
  assert.equal(definitionOutilLieux.name, 'lieux_chercher');
  assert.match(construirePromptSysteme([], {}), /lieux_chercher/);
});
