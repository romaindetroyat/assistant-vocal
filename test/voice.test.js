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

test('réglages mains libres : valeurs par défaut, validation, mot d\'activation normalisé', async () => {
  const { lireReglages, modifierReglages } = await import('../server/reglages.js');
  const defauts = await lireReglages();
  assert.equal(defauts.mainsLibres, false);
  assert.equal(defauts.motActivation, 'assistant');
  await assert.rejects(() => modifierReglages({ mainsLibres: 'oui' }), /booléen/);
  await assert.rejects(() => modifierReglages({ motActivation: 'a' }), /entre 2 et 40/);
  const r = await modifierReglages({ mainsLibres: true, motActivation: '  Jarvis  ' });
  assert.equal(r.mainsLibres, true);
  assert.equal(r.motActivation, 'jarvis');
  const app = creerApplication({ client: clientSimule('x'), serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const json = await (await app.request('/api/reglages', { headers: { cookie } })).json();
  assert.equal(json.mainsLibres, true); assert.equal(json.motActivation, 'jarvis');
  const ko = await app.request('/api/reglages', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ motActivation: '' }) });
  assert.equal(ko.status, 400);
  await modifierReglages({ mainsLibres: false, motActivation: 'assistant' });
});

test('mode voiture : contexte « voiture » dans la session Realtime (instructions renforcées, très court forcé)', async () => {
  const { CONSIGNE_VOITURE_REALTIME } = await import('../server/voice.js');
  const { modifierReglages } = await import('../server/reglages.js');
  await modifierReglages({ concision: 'normal' });
  const normale = configurationSession({ concision: 'normal' });
  assert.doesNotMatch(normale.instructions, /conduit/);
  const voiture = configurationSession({ concision: 'normal' }, { contexte: 'voiture' });
  assert.ok(voiture.instructions.includes(CONSIGNE_VOITURE_REALTIME));
  assert.match(voiture.instructions, /dix à vingt mots/); // concision forcée malgré le réglage « normal »
  assert.doesNotMatch(voiture.instructions, /Deux à quatre phrases/);
  // Un contexte inconnu est ignoré.
  assert.doesNotMatch(configurationSession({ concision: 'normal' }, { contexte: 'avion' }).instructions, /conduit/);

  process.env.OPENAI_API_KEY = 'sk-test';
  let corps;
  await creerJetonEphemere(async (_u, init) => { corps = JSON.parse(init.body); return new Response(JSON.stringify({ value: 'ek' })); }, { contexte: 'voiture' });
  assert.match(corps.session.instructions, /conduit/);
  // Route : le corps JSON `contexte` est transmis jusqu'aux instructions (fetch global simulé, aucun réseau).
  const fetchOriginal = globalThis.fetch;
  const appels = [];
  globalThis.fetch = async (url, init) => { appels.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ value: 'ek_v', expires_at: 1 }), { status: 200 }); };
  try {
    const app = creerApplication({ client: clientSimule('x'), serveurs: [] });
    const cookie = `assistant_session=${creerJeton()}`;
    const r = await app.request('/api/voice/session', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ contexte: 'voiture' }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).value, 'ek_v');
    assert.match(appels[0].body.session.instructions, /conduit/);
    await app.request('/api/voice/session', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
    assert.doesNotMatch(appels[1].body.session.instructions, /conduit/);
  } finally { globalThis.fetch = fetchOriginal; delete process.env.OPENAI_API_KEY; }
  await modifierReglages({ concision: 'court' });
});

test('mode voiture : /api/voice/ask force la concision très courte et interdit les liens', async () => {
  const { modifierReglages, CONSIGNE_VOITURE_CLAUDE } = await import('../server/reglages.js');
  await modifierReglages({ concision: 'normal' });
  const requetes = [];
  const client = { beta: { messages: { stream(p) { requetes.push(p); const r = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; return { async *[Symbol.asyncIterator]() {}, async finalMessage() { return r; } }; } } } };
  const app = creerApplication({ client, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  await app.request('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ message: 'Combien de temps pour aller à Toulon ?', contexte: 'voiture' }) });
  const consigneVoiture = requetes[0].messages.at(-1);
  assert.equal(consigneVoiture.role, 'system');
  assert.match(consigneVoiture.content, /dix à vingt mots/);
  assert.ok(consigneVoiture.content.includes(CONSIGNE_VOITURE_CLAUDE));
  await app.request('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ message: 'Et sans voiture ?' }) });
  const consigneNormale = requetes[1].messages.at(-1);
  assert.match(consigneNormale.content, /Deux à quatre phrases/);
  assert.doesNotMatch(consigneNormale.content, /conduit/);
  await modifierReglages({ concision: 'court' });
});

test('réglage voitureAutoAppel : vrai par défaut, booléen exigé, modifiable par /api/reglages', async () => {
  const { lireReglages, modifierReglages } = await import('../server/reglages.js');
  assert.equal((await lireReglages()).voitureAutoAppel, true);
  await assert.rejects(() => modifierReglages({ voitureAutoAppel: 'non' }), /booléen/);
  const app = creerApplication({ client: clientSimule('x'), serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const r = await (await app.request('/api/reglages', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ voitureAutoAppel: false }) })).json();
  assert.equal(r.voitureAutoAppel, false);
  assert.equal((await (await app.request('/api/reglages', { headers: { cookie } })).json()).voitureAutoAppel, false);
  await modifierReglages({ voitureAutoAppel: true });
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
