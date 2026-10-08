import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';
import { configurationSession, creerJetonEphemere, OUTIL_DELEGATION } from '../server/voice.js';

function clientSimule(texte) {
  return { beta: { messages: { stream() {
    const reponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: texte }] };
    return { async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: texte } }; }, async finalMessage() { return reponse; } };
  } } } };
}

test('session vocale : 501 sans clé, configuration et jeton éphémère avec clé', async () => {
  delete process.env.OPENAI_API_KEY;
  const app = creerApplication({ client: clientSimule('x'), serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  let r = await app.request('/api/voice/session', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  assert.equal(r.status, 501);
  assert.equal((await (await app.request('/api/me', { headers: { cookie } })).json()).voix, null);

  process.env.OPENAI_API_KEY = 'sk-test';
  const session = configurationSession();
  assert.equal(session.model, 'gpt-realtime-2.1-mini');
  assert.equal(session.tools[0].name, 'demander_assistant');
  assert.match(session.instructions, /demander_assistant/);
  const appels = [];
  const f = async (url, init) => { appels.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response(JSON.stringify({ value: 'ek_123', expires_at: 1 }), { status: 200 }); };
  const jeton = await creerJetonEphemere(f);
  assert.equal(jeton.value, 'ek_123');
  assert.equal(appels[0].url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(appels[0].auth, 'Bearer sk-test');
  assert.deepEqual(appels[0].body.session.tools, [OUTIL_DELEGATION]);
  delete process.env.OPENAI_API_KEY;
});

test('délégation /api/voice/ask : Claude répond, historique partagé', async () => {
  const app = creerApplication({ client: clientSimule('Il est 10 h.'), serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const r = await app.request('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ message: 'Quelle heure est-il ?' }) });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.text, 'Il est 10 h.');
  const conv = await (await app.request(`/api/conversations/${json.conversationId}`, { headers: { cookie } })).json();
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.messages[0].content[0].text, 'Quelle heure est-il ?');
});

test('les demandes vocales passent à Claude avec l\'effort rapide', async () => {
  const requetes = [];
  const client = { beta: { messages: { stream(p) { requetes.push(p); const r = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; return { async *[Symbol.asyncIterator]() {}, async finalMessage() { return r; } }; } } } };
  const app = creerApplication({ client, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  await app.request('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ message: 'Salut' }) });
  assert.deepEqual(requetes[0].output_config, { effort: 'low' });
  await (await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ content: [{ type: 'text', text: 'Salut' }] }) })).text();
  assert.deepEqual(requetes[1].output_config, { effort: 'medium' });
});

test('réglages : voix et concision appliqués à la session vocale et à la consigne Claude', async () => {
  const { modifierReglages } = await import('../server/reglages.js');
  await modifierReglages({ voix: 'cedar', concision: 'tres_court' });
  await assert.rejects(() => modifierReglages({ voix: 'robot' }), /inconnue/);
  process.env.OPENAI_API_KEY = 'sk-test';
  let corps;
  await creerJetonEphemere(async (_u, init) => { corps = JSON.parse(init.body); return new Response(JSON.stringify({ value: 'ek' })); });
  assert.equal(corps.session.audio.output.voice, 'cedar');
  assert.match(corps.session.instructions, /dix à vingt mots/);
  delete process.env.OPENAI_API_KEY;
  const requetes = [];
  const client = { beta: { messages: { stream(p) { requetes.push(p); const r = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; return { async *[Symbol.asyncIterator]() {}, async finalMessage() { return r; } }; } } } };
  const app = creerApplication({ client, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  await app.request('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ message: 'Salut' }) });
  const dernier = requetes[0].messages.at(-1);
  assert.equal(dernier.role, 'system');
  assert.match(dernier.content, /dix à vingt mots/);
  const r = await (await app.request('/api/reglages', { headers: { cookie } })).json();
  assert.equal(r.voix, 'cedar');
});

test('aperçu de voix : généré une fois puis servi depuis le cache', async () => {
  const { apercuVoix } = await import('../server/voice.js');
  const store = await import('../server/store.js');
  process.env.OPENAI_API_KEY = 'sk-test';
  let appels = 0;
  const f = async (url, init) => { appels++; assert.equal(url, 'https://api.openai.com/v1/audio/speech'); assert.equal(JSON.parse(init.body).voice, 'cedar'); return new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 }); };
  const a = await apercuVoix('cedar', store, f);
  const b = await apercuVoix('cedar', store, f);
  assert.deepEqual([...a], [73, 68, 51, 4]);
  assert.deepEqual([...b], [73, 68, 51, 4]);
  assert.equal(appels, 1);
  delete process.env.OPENAI_API_KEY;
});
