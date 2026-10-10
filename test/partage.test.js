import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerJeton as creerJetonAppareil, verifierJeton, revoquerJeton, listerJetons, jetonDepuisEntete } from '../server/jetons.js';
import { lireValeur, ecrireValeur } from '../server/store.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const cookie = `assistant_session=${creerJeton()}`;

test('jetons d\'appareil : création, hachage, vérification, dernier usage, révocation', async () => {
  await ecrireValeur('jetons-appareils', []);
  const { id, nom, jeton } = await creerJetonAppareil('  iPhone de Romain ');
  assert.equal(nom, 'iPhone de Romain');
  assert.match(jeton, /^[0-9a-f]{64}$/, '32 octets en hexadécimal');
  const stockes = await lireValeur('jetons-appareils');
  assert.equal(stockes.length, 1);
  assert.equal(stockes[0].id, id);
  assert.match(stockes[0].hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stockes[0].hash, jeton, 'le jeton n\'est pas stocké en clair');
  assert.ok(!JSON.stringify(stockes).includes(jeton));
  assert.equal(stockes[0].dernierUsage, null);

  const entree = await verifierJeton(jeton);
  assert.equal(entree.id, id);
  assert.equal(entree.hash, undefined, 'le hash ne sort pas');
  assert.ok(entree.dernierUsage, 'dernier usage mis à jour');
  assert.equal(await verifierJeton('0'.repeat(64)), null);
  assert.equal(await verifierJeton('pas-un-jeton'), null);
  assert.equal(await verifierJeton(undefined), null);

  assert.equal(jetonDepuisEntete(`Bearer ${jeton}`), jeton);
  assert.equal(jetonDepuisEntete(`bearer ${jeton.toUpperCase()}`), jeton);
  assert.equal(jetonDepuisEntete('Basic abc'), null);

  const liste = await listerJetons();
  assert.equal(liste.length, 1);
  assert.ok(!('hash' in liste[0]));
  assert.equal(await revoquerJeton('inconnu'), false);
  assert.equal(await revoquerJeton(id), true);
  assert.equal(await verifierJeton(jeton), null, 'révoqué : refusé');
  assert.deepEqual(await listerJetons(), []);
  await assert.rejects(creerJetonAppareil('   '), /Nom/);
});

test('routes /api/jetons : cookie obligatoire, liste sans hash, création puis révocation', async () => {
  await ecrireValeur('jetons-appareils', []);
  const app = creerApplication({ client: {}, serveurs: [] });
  let r = await app.request('/api/jetons');
  assert.equal(r.status, 401);
  r = await app.request('/api/jetons', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ nom: 'iPhone' }) });
  assert.equal(r.status, 201);
  const cree = await r.json();
  assert.match(cree.jeton, /^[0-9a-f]{64}$/);
  r = await app.request('/api/jetons', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400);
  r = await app.request('/api/jetons', { headers: { cookie } });
  const liste = await r.json();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].nom, 'iPhone');
  assert.ok(!('hash' in liste[0]) && !('jeton' in liste[0]));
  // Un jeton d'appareil ne donne pas accès aux routes de gestion
  r = await app.request('/api/jetons', { headers: { Authorization: `Bearer ${cree.jeton}` } });
  assert.equal(r.status, 401);
  r = await app.request(`/api/jetons/${cree.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r.status, 200);
  r = await app.request(`/api/jetons/${cree.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r.status, 404);
});
