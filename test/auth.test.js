import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerApplication } from '../server/index.js';
import { creerJeton, jetonValide } from '../server/auth.js';

const app = creerApplication({ client: {}, serveurs: [] });

test('jeton signé : valide, falsifié, expiré', () => {
  const jeton = creerJeton();
  assert.equal(jetonValide(jeton), true);
  assert.equal(jetonValide(`${jeton}x`), false);
  assert.equal(jetonValide(creerJeton(Date.now() - 100 * 24 * 3600 * 1000)), false);
  assert.equal(jetonValide(undefined), false);
});

test('/api/me refuse sans session', async () => {
  const r = await app.request('/api/me');
  assert.equal(r.status, 401);
});

test('login incorrect → 401, login correct → cookie puis accès', async () => {
  const mauvais = await app.request('/api/login', { method: 'POST', body: JSON.stringify({ password: 'non' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(mauvais.status, 401);
  const bon = await app.request('/api/login', { method: 'POST', body: JSON.stringify({ password: 'secret-de-test' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(bon.status, 200);
  const cookie = bon.headers.get('set-cookie');
  assert.match(cookie, /assistant_session=.*HttpOnly/);
  const moi = await app.request('/api/me', { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(moi.status, 200);
  const json = await moi.json();
  assert.equal(json.model, 'claude-opus-5-5');
  assert.deepEqual(json.serveurs, []);
});

test('la racine redirige vers /login sans session', async () => {
  const r = await app.request('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
});
