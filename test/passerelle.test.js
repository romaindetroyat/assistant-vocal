// Passerelle mails (MODE=mails) : seuls les outils Gmail sont exposés au serveur MCP ; tout ce qui consomme est coupé.
import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireValeur } from '../server/store.js';
import { traiterRequeteJsonRpc } from '../server/mcp-server.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

process.env.MODE = 'mails';
const contexte = { client: () => { throw new Error('Claude ne doit pas être appelé'); }, serveurs: async () => [] };

test('passerelle mails : MCP limité aux outils Gmail, autres outils refusés', async () => {
  await ecrireValeur('google-comptes', [{ email: 'perso@exemple.fr', access_token: 'A', expires_at: Date.now() + 3_600_000 }]);
  const init = await traiterRequeteJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, contexte);
  assert.match(init.result.instructions, /^Accès Gmail/);
  const { result } = await traiterRequeteJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, contexte);
  const noms = result.tools.map((t) => t.name);
  assert.ok(noms.length >= 5 && noms.every((n) => n.startsWith('gmail_')), noms.join(', '));
  assert.ok(!noms.includes('demander_assistant'));
  const r = await traiterRequeteJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'demander_assistant', arguments: { message: 'x' } } }, contexte);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /passerelle Gmail/);
  const comptes = await traiterRequeteJsonRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'gmail_comptes', arguments: {} } }, contexte);
  assert.equal(comptes.result.content[0].text, 'perso@exemple.fr');
  await ecrireValeur('google-comptes', []);
});

test('passerelle mails : chat, voix, Siri, partage et coffre renvoient 410 ; la gestion des comptes Google reste', async () => {
  const app = creerApplication({ client: { beta: { messages: { stream() { throw new Error('Claude ne doit pas être appelé'); } } } }, serveurs: [] });
  const entetes = { 'Content-Type': 'application/json', cookie: `assistant_session=${creerJeton()}` };
  for (const route of ['/api/chat', '/api/voice/ask', '/api/voice/session', '/api/partage', '/api/documents']) {
    const r = await app.request(route, { method: 'POST', headers: entetes, body: '{}' });
    assert.equal(r.status, 410, route);
  }
  const g = await app.request('/api/google', { headers: entetes });
  assert.equal(g.status, 200);
});
