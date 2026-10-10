import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enregistrerUsage, lireUsage, coutUsd } from '../server/usage.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

test('usage : cumul par jour, sources, coût estimé, route /api/usage', async () => {
  const d = new Date('2030-01-05T10:00:00Z');
  await enregistrerUsage({ input_tokens: 100, cache_read_input_tokens: 15000, cache_creation_input_tokens: 0, output_tokens: 300 }, 'voix', d);
  await enregistrerUsage({ input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 16000, output_tokens: 100 }, 'chat', d);
  const u = await lireUsage(3, d);
  assert.equal(u.jours.length, 1);
  const j = u.jours[0];
  assert.equal(j.jour, '2030-01-05'); assert.equal(j.appels, 2); assert.equal(j.entree, 150); assert.equal(j.cache_lecture, 15000); assert.equal(j.cache_ecriture, 16000); assert.equal(j.sortie, 400);
  assert.deepEqual(j.sources, { voix: 1, chat: 1 });
  assert.equal(j.cout, Number(coutUsd(j).toFixed(3)));
  assert.ok(Math.abs(coutUsd(j) - (150 * 4 + 15000 * 0.2 + 16000 * 5 + 400 * 20) / 1e6) < 1e-9);
  assert.equal(await enregistrerUsage(null), null);
  const app = creerApplication({ client: {}, serveurs: [] });
  assert.equal((await app.request('/api/usage')).status, 401);
  const r = await (await app.request('/api/usage', { headers: { cookie: `assistant_session=${creerJeton()}` } })).json();
  assert.ok(Array.isArray(r.jours) && r.tarifs.sortie === 20);
});
