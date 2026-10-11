import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

test('journal client : enregistré (300 max, champs bornés), relu, 401 sans session', async () => {
  const app = creerApplication({ client: {}, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const post = (corps, avecCookie = true) => app.request('/api/diag/client', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(avecCookie ? { cookie } : {}) }, body: JSON.stringify(corps) });
  assert.equal((await post({ evenements: [{ type: 'x' }] }, false)).status, 401);
  const r = await (await post({ ua: 'iPhone', evenements: [{ t: '2026-10-11T08:00:00Z', type: 'reconnexion', details: '1 : état failed'.padEnd(500, '.'), voiture: true }] })).json();
  assert.equal(r.ajoutes, 1);
  const liste = await (await app.request('/api/diag/client', { headers: { cookie } })).json();
  const dernier = liste.at(-1);
  assert.equal(dernier.type, 'reconnexion'); assert.equal(dernier.voiture, true); assert.equal(dernier.appareil, 'iPhone'); assert.equal(dernier.details.length, 200);
  await post({ evenements: Array.from({ length: 100 }, (_, i) => ({ type: `e${i}` })) });
  await post({ evenements: Array.from({ length: 100 }, (_, i) => ({ type: `f${i}` })) });
  await post({ evenements: Array.from({ length: 100 }, (_, i) => ({ type: `g${i}` })) });
  assert.equal((await (await app.request('/api/diag/client', { headers: { cookie } })).json()).length, 300);
});
