import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerBackendKv } from '../server/store-kv.js';

// KV simulé (API get(key,'json') / put / delete)
function kvSimule() {
  const m = new Map();
  return { async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

test('backend KV : conversations, index, abonnements, rappels', async () => {
  const s = creerBackendKv(kvSimule());
  const c = await s.creerConversation();
  c.messages.push({ role: 'user', content: 'x' }); c.titre = 'Test';
  await s.sauverConversation(c);
  assert.deepEqual((await s.listerConversations()).map((r) => [r.id, r.titre, r.nbMessages]), [[c.id, 'Test', 1]]);
  assert.equal((await s.lireConversation(c.id)).titre, 'Test');
  await s.supprimerConversation(c.id);
  assert.deepEqual(await s.listerConversations(), []);
  assert.equal(await s.lireConversation(c.id), null);
  await assert.rejects(async () => s.lireConversation('../x'), /invalide/);

  assert.equal(await s.ajouterAbonnement({ endpoint: 'https://p/1', keys: { p256dh: 'a', auth: 'b' } }), 1);
  assert.equal(await s.ajouterAbonnement({ endpoint: 'https://p/1', keys: { p256dh: 'a', auth: 'b' } }), 1);
  await s.retirerAbonnement('https://p/1');
  assert.deepEqual(await s.listerAbonnements(), []);
  await s.sauverRappels([{ id: 'r1' }]);
  assert.deepEqual(await s.listerRappels(), [{ id: 'r1' }]);
});
