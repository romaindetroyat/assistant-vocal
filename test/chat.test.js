import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executerTour } from '../server/chat.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';
import * as store from '../server/store.js';

// Client Anthropic simulé : rejoue une liste de réponses, enregistre les requêtes.
function clientSimule(reponses) {
  const requetes = [];
  return {
    requetes,
    beta: { messages: { stream(params) {
      requetes.push(structuredClone(params));
      const reponse = reponses.shift();
      const evenements = [];
      for (const bloc of reponse.content) {
        evenements.push({ type: 'content_block_start', content_block: bloc });
        if (bloc.type === 'text') evenements.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: bloc.text } });
      }
      return {
        async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; },
        async finalMessage() { return reponse; },
      };
    } } },
  };
}

const outilLocalTest = [{ name: 'list_reminders', description: 'x', strict: true, input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } }];

test('tour simple : texte streamé, historique enrichi, requête bien formée', async () => {
  const client = clientSimule([{ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Bonjour !' }] }]);
  const conversation = { titre: 'Nouvelle conversation', messages: [] };
  const serveurs = [{ name: 'gmail', url: 'https://x.invalid/gmail', description: 'Mail', authorization_token: 'jeton-secret-xyz' }];
  const evts = [];
  for await (const e of executerTour({ client, conversation, contenuUtilisateur: [{ type: 'text', text: 'Salut' }], serveurs, outilsLocaux: outilLocalTest })) evts.push(e);

  assert.deepEqual(evts.map((e) => e.type), ['text', 'done']);
  assert.equal(evts.at(-1).text, 'Bonjour !');
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.titre, 'Salut');

  const req = client.requetes[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.betas, ['mcp-client-2025-11-20', 'server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.deepEqual(req.output_config, { effort: 'medium' });
  assert.deepEqual(req.mcp_servers, [{ type: 'url', url: 'https://x.invalid/gmail', name: 'gmail', authorization_token: 'jeton-secret-xyz' }]);
  assert.ok(req.tools.some((t) => t.type === 'mcp_toolset' && t.mcp_server_name === 'gmail'));
  assert.ok(req.tools.some((t) => t.type === 'web_search_20260209'));
  assert.match(req.system[0].text, /gmail : Mail/);
  assert.ok(!req.system[0].text.includes('jeton-secret-xyz'), 'le jeton ne doit pas apparaître dans le prompt');
});

test('outil local : exécution, tool_result renvoyé, puis réponse finale', async () => {
  const client = clientSimule([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_reminders', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Aucun rappel.' }] },
  ]);
  const conversation = { titre: 'x', messages: [] };
  const evts = [];
  for await (const e of executerTour({ client, conversation, contenuUtilisateur: [{ type: 'text', text: 'Mes rappels ?' }], serveurs: [], outilsLocaux: outilLocalTest })) evts.push(e);

  assert.deepEqual(evts.map((e) => e.type), ['tool_use', 'tool_result', 'text', 'done']);
  assert.equal(evts[1].ok, true);
  assert.equal(client.requetes.length, 2);
  const resultats = client.requetes[1].messages.at(-1);
  assert.equal(resultats.role, 'user');
  assert.equal(resultats.content[0].type, 'tool_result');
  assert.equal(resultats.content[0].tool_use_id, 'toolu_1');
  assert.equal(client.requetes[1].mcp_servers, undefined, 'sans serveur, pas de mcp_servers');
});

test('outils MCP côté serveur : événements tool_use émis, blocs rejoués, fallback filtré', async () => {
  const client = clientSimule([{
    stop_reason: 'end_turn',
    content: [
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'mcp_tool_use', id: 'm1', name: 'search_threads', server_name: 'gmail', input: {} },
      { type: 'mcp_tool_result', tool_use_id: 'm1', is_error: false, content: [] },
      { type: 'text', text: 'Trois mails.' },
    ],
  }]);
  const conversation = { titre: 'x', messages: [] };
  const evts = [];
  for await (const e of executerTour({ client, conversation, contenuUtilisateur: [{ type: 'text', text: 'Mes mails' }], serveurs: [], outilsLocaux: outilLocalTest })) evts.push(e);
  assert.deepEqual(evts[0], { type: 'tool_use', name: 'search_threads', server: 'gmail' });
  const types = conversation.messages[1].content.map((b) => b.type);
  assert.deepEqual(types, ['mcp_tool_use', 'mcp_tool_result', 'text']);
});

test('POST /api/chat : flux SSE et conversation persistée', async () => {
  const client = clientSimule([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ok.' }] }]);
  const app = creerApplication({ client, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const r = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ content: [{ type: 'text', text: 'Test' }] }) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const corps = await r.text();
  assert.match(corps, /event: start/);
  assert.match(corps, /event: text/);
  assert.match(corps, /event: done/);
  const id = JSON.parse(corps.match(/event: start\ndata: (.*)/)[1]).conversationId;
  const conv = await store.lireConversation(id);
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.titre, 'Test');
  const liste = await (await app.request('/api/conversations', { headers: { cookie } })).json();
  assert.equal(liste[0].id, id);
});

test("POST /api/mcp : ajout d'un serveur depuis l'application, détection OAuth, retrait", async () => {
  const app = creerApplication({ client: {}, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const h = { 'Content-Type': 'application/json', cookie };
  // Serveur sans métadonnées OAuth joignables → mode jeton
  let r = await app.request('/api/mcp', { method: 'POST', headers: h, body: JSON.stringify({ name: 'zap', url: 'https://mcp.invalid/x', authorization_token: 'abc' }) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).auth, 'token');
  const liste = await (await app.request('/api/mcp', { headers: { cookie } })).json();
  assert.deepEqual(liste.map((s) => [s.name, s.source, s.connecte]), [['zap', 'app', true]]);
  r = await app.request('/api/mcp', { method: 'POST', headers: h, body: JSON.stringify({ name: 'zap', url: 'https://mcp.invalid/y' }) });
  assert.equal(r.status, 400);
  r = await app.request('/api/mcp/zap/remove', { method: 'DELETE', headers: { cookie } });
  assert.equal(r.status, 200);
  assert.deepEqual(await (await app.request('/api/mcp', { headers: { cookie } })).json(), []);
});

test('catalogue : liste, ajout en un clic (mode oauth), déjà ajouté', async () => {
  const app = creerApplication({ client: {}, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const liste = await (await app.request('/api/catalogue', { headers: { cookie } })).json();
  assert.ok(liste.length > 20);
  assert.equal(liste.find((e) => e.id === 'notion').ajoute, false);
  let r = await app.request('/api/mcp/catalogue/notion', { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 201);
  const mcp = await (await app.request('/api/mcp', { headers: { cookie } })).json();
  const notion = mcp.find((s) => s.name === 'notion');
  assert.equal(notion.auth, 'oauth'); assert.equal(notion.connecte, false); assert.equal(notion.source, 'app');
  assert.equal((await (await app.request('/api/catalogue', { headers: { cookie } })).json()).find((e) => e.id === 'notion').ajoute, true);
  r = await app.request('/api/mcp/catalogue/inconnu', { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 404);
  await app.request('/api/mcp/notion/remove', { method: 'DELETE', headers: { cookie } });
});
