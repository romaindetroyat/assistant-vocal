import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerTrajet, heureDepart, executerOutilTrajets, enregistrerConfigTrajets, retirerConfigTrajets, configTrajets, masquerCle, definirPositionCourante, consignePosition, lieuRoutes, MESSAGE_SANS_CLE } from '../server/trajets.js';
import { outilsLocauxDisponibles, nomsOutilsLocaux, executerOutilLocal } from '../server/tools.js';
import { lireReglages, modifierReglages } from '../server/reglages.js';
import { ecrireValeur } from '../server/store.js';

const CLE = 'AIzaSyTESTtesttesttesttesttesttest1234';
const DOMICILE = '12 rue des Lilas, 83000 Toulon';

// Google Routes simulé : durées avec/sans trafic différentes, journal des requêtes.
function routesSimule(journal, { dureeTrafic = '2700s', dureeStatique = '2400s', distance = 52000 } = {}) {
  return async (url, init = {}) => {
    const corps = JSON.parse(init.body || '{}');
    journal.push({ url: String(url), headers: init.headers, corps });
    if (!String(url).startsWith('https://routes.googleapis.com/directions/v2:computeRoutes')) return new Response(JSON.stringify({ error: { message: `inattendu ${url}` } }), { status: 500 });
    if (init.headers['X-Goog-Api-Key'] !== CLE) return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 403 });
    const route = { duration: corps.routingPreference === 'TRAFFIC_UNAWARE' || corps.travelMode !== 'DRIVE' ? dureeStatique : dureeTrafic, staticDuration: dureeStatique, distanceMeters: distance, description: 'A50', legs: [{ steps: [{ navigationInstruction: { instructions: 'Prendre la direction de Marseille' } }, { navigationInstruction: { instructions: 'Rejoindre l\'A50' } }] }] };
    return new Response(JSON.stringify({ routes: [route] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

test('trajets : sans clé, l\'outil répond par un message explicite (pas d\'exception) ; outils non stricts', async () => {
  await retirerConfigTrajets(); delete process.env.GOOGLE_MAPS_API_KEY;
  assert.deepEqual(await configTrajets(), { cle: '', source: null });
  assert.equal(await executerOutilTrajets('trajet_calculer', { destination: 'Toulon' }), MESSAGE_SANS_CLE);
  assert.match(await executerOutilLocal('trajet_calculer', { destination: 'Toulon' }), /Mes outils › Trajets/);
  assert.ok(nomsOutilsLocaux.has('trajet_calculer') && nomsOutilsLocaux.has('trajet_adresse_definir'));
  const outils = await outilsLocauxDisponibles();
  for (const nom of ['trajet_calculer', 'trajet_adresse_definir']) { const o = outils.find((t) => t.name === nom); assert.ok(o && !o.strict, `${nom} présent et non strict`); }
  assert.equal(outils.filter((t) => t.strict).length, 3, 'outils stricts inchangés (tache_ajouter, schedule_reminder, memoire_noter)');
});

test('trajets : configuration (validation, masquage), adresses domicile/bureau, position courante', async () => {
  await assert.rejects(() => enregistrerConfigTrajets({ cle: 'trop court' }), /invalide/);
  await enregistrerConfigTrajets({ cle: ` ${CLE} ` });
  assert.deepEqual(await configTrajets(), { cle: CLE, source: 'app' });
  assert.equal(masquerCle(CLE), 'AIza…1234');
  assert.equal(await executerOutilTrajets('trajet_adresse_definir', { lieu: 'domicile', adresse: `  ${DOMICILE}  ` }), `Adresse du domicile enregistrée : ${DOMICILE}.`);
  await assert.rejects(() => executerOutilTrajets('trajet_adresse_definir', { lieu: 'plage', adresse: 'x' }), /domicile ou bureau/);
  await assert.rejects(() => modifierReglages({ bureau: 'x'.repeat(201) }), /200/);
  const r = await lireReglages();
  assert.equal(r.domicile, DOMICILE); assert.equal(r.bureau, ''); assert.equal(r.partagerPosition, false);
  assert.equal(consignePosition({ lat: '43.12345678', lng: 5.9312, precision: 12.4 }), "Position actuelle de l'utilisateur : 43.12346,5.9312 (±12 m). Pour un trajet depuis « ici », laisse l'origine vide.");
  assert.equal(consignePosition({ lat: 95, lng: 0 }), null, 'latitude hors limites ignorée');
  assert.equal(definirPositionCourante(null), null);
  assert.deepEqual(lieuRoutes('43.1,5.9'), { location: { latLng: { latitude: 43.1, longitude: 5.9 } } });
  assert.deepEqual(lieuRoutes('Toulon'), { address: 'Toulon' });
});

test('calculerTrajet : parsing Routes, en-têtes, liens Plans / Google Maps, origine par défaut', async () => {
  await enregistrerConfigTrajets({ cle: CLE }); await modifierReglages({ domicile: DOMICILE }); definirPositionCourante(null);
  const journal = []; const f = routesSimule(journal);
  const t = await calculerTrajet({ destination: 'Gare Saint-Charles, Marseille' }, f);
  assert.equal(journal.length, 1);
  const req = journal[0];
  assert.equal(req.headers['X-Goog-Api-Key'], CLE);
  assert.match(req.headers['X-Goog-FieldMask'], /routes\.duration,routes\.staticDuration,routes\.distanceMeters/);
  assert.deepEqual(req.corps.origin, { address: DOMICILE }, 'origine vide = domicile');
  assert.equal(req.corps.travelMode, 'DRIVE'); assert.equal(req.corps.routingPreference, 'TRAFFIC_AWARE'); assert.equal(req.corps.languageCode, 'fr-FR');
  assert.equal(t.dureeTraficMin, 45); assert.equal(t.dureeMin, 40); assert.equal(t.distanceKm, 52); assert.equal(t.resume, 'A50'); assert.equal(t.heureDepart, null);
  assert.deepEqual(t.etapes, ['Prendre la direction de Marseille', "Rejoindre l'A50"]);
  const plans = new URL(t.lienPlans); assert.equal(plans.host, 'maps.apple.com'); assert.equal(plans.searchParams.get('daddr'), 'Gare Saint-Charles, Marseille'); assert.equal(plans.searchParams.get('saddr'), DOMICILE); assert.equal(plans.searchParams.get('dirflg'), 'd');
  const google = new URL(t.lienGoogle); assert.equal(google.pathname, '/maps/dir/'); assert.equal(google.searchParams.get('api'), '1'); assert.equal(google.searchParams.get('destination'), 'Gare Saint-Charles, Marseille'); assert.equal(google.searchParams.get('travelmode'), 'driving');

  // Position partagée : devient l'origine par défaut (coordonnées).
  definirPositionCourante({ lat: 43.1, lng: 5.9 });
  const t2 = await calculerTrajet({ origine: '', destination: 'bureau', mode: 'walk' }, f).catch((e) => e);
  assert.match(t2.message, /bureau inconnue/);
  await modifierReglages({ bureau: 'Place de la Liberté, Toulon' });
  const t3 = await calculerTrajet({ origine: '', destination: 'bureau', mode: 'walk' }, f);
  assert.deepEqual(journal.at(-1).corps.origin, { location: { latLng: { latitude: 43.1, longitude: 5.9 } } });
  assert.equal(journal.at(-1).corps.travelMode, 'WALK'); assert.equal(journal.at(-1).corps.routingPreference, undefined, 'pas de préférence trafic hors voiture');
  assert.equal(t3.destination, 'Place de la Liberté, Toulon'); assert.equal(new URL(t3.lienPlans).searchParams.get('dirflg'), 'w');
  definirPositionCourante(null);

  const sansRoute = async () => new Response(JSON.stringify({ routes: [] }), { status: 200 });
  await assert.rejects(() => calculerTrajet({ destination: 'Nulle part' }, sansRoute), /Aucun itinéraire/);
  const refus = async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 403 });
  await assert.rejects(() => calculerTrajet({ destination: 'Toulon' }, refus), /Google Routes : API key not valid/);
});

test('heure de départ : deux appels en voiture (sans puis avec trafic), marge de 5 min, arrivalTime en transports', async () => {
  await enregistrerConfigTrajets({ cle: CLE }); await modifierReglages({ domicile: DOMICILE }); definirPositionCourante(null);
  const journal = []; const f = routesSimule(journal);
  const maintenant = new Date('2026-10-10T06:00:00Z');
  const arrivee = '2026-10-10T14:00:00+02:00'; // 12:00Z
  const { heureDepart: hd, dureeTraficMin, trajet } = await heureDepart({ destination: 'Toulon', arriveeA: arrivee }, f, maintenant);
  assert.equal(journal.length, 2);
  assert.equal(journal[0].corps.routingPreference, 'TRAFFIC_UNAWARE'); assert.equal(journal[0].corps.departureTime, undefined);
  assert.equal(journal[1].corps.routingPreference, 'TRAFFIC_AWARE');
  assert.equal(journal[1].corps.departureTime, '2026-10-10T11:15:00.000Z', 'départ estimé = arrivée − 40 min − 5 min');
  assert.equal(dureeTraficMin, 45);
  assert.equal(hd, '2026-10-10T11:10:00.000Z', 'départ conseillé = arrivée − 45 min (trafic) − 5 min');
  const texte = await executerOutilTrajets('trajet_calculer', { destination: 'Toulon', arriveeA: arrivee }, f);
  assert.match(texte, /^Environ 45 min avec le trafic \(40 min sans\), 52 km en voiture par A50, jusqu'à Toulon\./);
  assert.match(texte, /Départ conseillé à 13 h 10 \(marge de 5 min comprise\) pour arriver à 14 h 00\./);
  assert.match(texte, /\nPlans : https:\/\/maps\.apple\.com\/\?[^\n]+\nGoogle Maps : https:\/\/www\.google\.com\/maps\/dir\/\?[^\n]+$/);
  assert.equal(trajet.arriveeA, '2026-10-10T12:00:00.000Z');

  // Transports : un seul appel avec arrivalTime ; heure de départ = arrivée − durée.
  journal.length = 0;
  const tr = await calculerTrajet({ destination: 'Toulon', mode: 'TRANSIT', arriveeA: arrivee }, f, maintenant);
  assert.equal(journal.length, 1); assert.equal(journal[0].corps.arrivalTime, '2026-10-10T12:00:00.000Z'); assert.equal(journal[0].corps.routingPreference, undefined);
  assert.equal(tr.heureDepart, '2026-10-10T11:20:00.000Z');
  assert.equal(new URL(tr.lienGoogle).searchParams.get('travelmode'), 'transit');

  // Départ estimé déjà passé : pas de departureTime (Routes refuse le passé) ; heure invalide → erreur lisible.
  journal.length = 0;
  await calculerTrajet({ destination: 'Toulon', arriveeA: arrivee }, f, new Date('2026-10-10T11:30:00Z'));
  assert.equal(journal[1].corps.departureTime, undefined);
  assert.match(await executerOutilTrajets('trajet_calculer', { destination: 'Toulon', arriveeA: 'demain midi' }, f), /Trajet impossible : Heure d'arrivée invalide/);
  await ecrireValeur('reglages', {});
});

// ---------- Routes HTTP ----------
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';
const cookie = `assistant_session=${creerJeton()}`;
const entetes = { 'Content-Type': 'application/json', cookie };

// Client Anthropic simulé (même principe que brief.test.js) : rejoue des réponses, enregistre les requêtes.
function clientSimule(reponses) {
  const requetes = [];
  return {
    requetes,
    beta: { messages: { stream(params) {
      requetes.push(structuredClone(params));
      const reponse = reponses.shift();
      if (!reponse) throw new Error('API indisponible (simulation)');
      const evenements = [];
      for (const bloc of reponse.content) {
        evenements.push({ type: 'content_block_start', content_block: bloc });
        if (bloc.type === 'text') evenements.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: bloc.text } });
      }
      return { async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; }, async finalMessage() { return reponse; } };
    } } },
  };
}
const reponseTexte = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

test('routes /api/trajets/config : clé masquée, adresses et partage de position ; /api/trajets sans destination → 400', async () => {
  await retirerConfigTrajets(); await ecrireValeur('reglages', {});
  const app = creerApplication({ client: clientSimule([]), serveurs: [] });
  let r = await app.request('/api/trajets/config', { headers: { cookie } });
  assert.deepEqual(await r.json(), { configure: false, source: null, cle: null, domicile: '', bureau: '', partagerPosition: false });
  r = await app.request('/api/trajets/config', { method: 'PUT', headers: entetes, body: JSON.stringify({ cle: CLE, domicile: DOMICILE, partagerPosition: true }) });
  assert.equal(r.status, 200);
  const cfg = await r.json();
  assert.equal(cfg.configure, true); assert.equal(cfg.source, 'app'); assert.equal(cfg.cle, 'AIza…1234'); assert.equal(cfg.domicile, DOMICILE); assert.equal(cfg.partagerPosition, true);
  assert.ok(!JSON.stringify(cfg).includes(CLE), 'la clé complète ne sort jamais');
  r = await app.request('/api/trajets/config', { method: 'PUT', headers: entetes, body: JSON.stringify({ cle: 'courte' }) });
  assert.equal(r.status, 400);
  r = await app.request('/api/trajets', { method: 'POST', headers: entetes, body: JSON.stringify({ origine: '' }) });
  assert.equal(r.status, 400); assert.match((await r.json()).erreur, /Destination manquante/);
  r = await app.request('/api/trajets/config');
  assert.equal(r.status, 401, 'session obligatoire');
  r = await app.request('/api/trajets/config', { method: 'PUT', headers: entetes, body: JSON.stringify({ cle: '' }) });
  assert.equal((await r.json()).configure, false, 'clé effacée');
});

test('position jointe à /api/chat et /api/voice/ask : consigne « Position actuelle » ; la voix ne lit pas les liens', async () => {
  const client = clientSimule([reponseTexte('Vous êtes à Toulon.'), reponseTexte('Comptez 45 min.\nPlans : https://maps.apple.com/?daddr=Toulon\nGoogle Maps : https://www.google.com/maps/dir/?api=1&destination=Toulon'), reponseTexte('Bonjour.')]);
  const app = creerApplication({ client, serveurs: [] });
  let r = await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Où suis-je ?' }], position: { lat: 43.1242, lng: 5.928, precision: 20 } }) });
  assert.equal(r.status, 200); await r.text();
  let consigne = client.requetes[0].messages.at(-1);
  assert.equal(consigne.role, 'system'); assert.match(consigne.content, /Position actuelle de l'utilisateur : 43\.1242,5\.928 \(±20 m\)/);
  r = await app.request('/api/voice/ask', { method: 'POST', headers: entetes, body: JSON.stringify({ message: 'Temps pour Toulon ?', position: { lat: 43.1, lng: 5.9 } }) });
  const j = await r.json();
  assert.equal(j.text, 'Comptez 45 min.', 'liens retirés pour la lecture à voix haute');
  consigne = client.requetes[1].messages.at(-1);
  assert.match(consigne.content, /lue à voix haute/); assert.match(consigne.content, /Position actuelle de l'utilisateur : 43\.1,5\.9\./);
  r = await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Salut' }] }) });
  await r.text();
  assert.ok(!client.requetes[2].messages.some((m) => m.role === 'system'), 'sans position : pas de consigne');
  assert.equal(definirPositionCourante(undefined), null);
});
