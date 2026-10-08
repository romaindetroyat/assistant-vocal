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
