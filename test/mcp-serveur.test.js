import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const pkce = async () => { const v = b64url(crypto.getRandomValues(new Uint8Array(32))); const c = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))); return { v, c }; };

test("l'assistant en serveur MCP : découverte, inscription, consentement, PKCE, jetons, outils, rafraîchissement, révocation", async () => {
  const client = { beta: { messages: { stream() { const r = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Réponse de Claude.' }] }; return { async *[Symbol.asyncIterator]() {}, async finalMessage() { return r; } }; } } } };
  const app = creerApplication({ client, serveurs: [] });
  const O = 'http://localhost';
  const meta = await (await app.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(meta.registration_endpoint, `${O}/oauth/register`);
  const res = await (await app.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(res.resource, `${O}/mcp`);

  // Sans jeton : 401 + indication de la ressource protégée
  let r = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) });
  assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /resource_metadata=/);

  // Inscription dynamique
  r = await app.request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }) });
  assert.equal(r.status, 201);
  const cl = await r.json(); assert.match(cl.client_id, /^av_/); assert.equal(cl.client_secret, undefined);
  r = await app.request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['ftp://x'] }) });
  assert.equal(r.status, 400);

  // Autorisation : sans session → redirection vers la connexion ; avec session → page de consentement
  const { v, c } = await pkce();
  const qs = `client_id=${cl.client_id}&redirect_uri=${encodeURIComponent('https://claude.ai/api/mcp/auth_callback')}&response_type=code&code_challenge=${c}&code_challenge_method=S256&state=xyz&scope=assistant`;
  r = await app.request(`/oauth/authorize?${qs}`);
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^\/login\?next=/);
  const cookie = `assistant_session=${creerJeton()}`;
  r = await app.request(`/oauth/authorize?${qs}`, { headers: { cookie } });
  assert.equal(r.status, 200); assert.match(await r.text(), /Autoriser « Claude »/);
  const form = new URLSearchParams({ client_id: cl.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: c, state: 'xyz', scope: 'assistant', decision: 'oui' });
  r = await app.request('/oauth/authorize', { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  assert.equal(r.status, 302);
  const retour = new URL(r.headers.get('location'));
  assert.equal(retour.searchParams.get('state'), 'xyz');
  const code = retour.searchParams.get('code'); assert.ok(code);

  // Échange du code (mauvais verifier refusé, bon accepté, code à usage unique)
  const corpsJeton = (verifier) => new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: cl.client_id, code_verifier: verifier });
  r = await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpsJeton('mauvais') });
  assert.equal(r.status, 400);
  r = await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpsJeton(v) });
  assert.equal(r.status, 400, 'le code a été consommé par la tentative précédente');

  // Nouveau cycle complet
  const { v: v2, c: c2 } = await pkce();
  r = await app.request('/oauth/authorize', { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cl.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: c2, state: 's2', scope: 'assistant', decision: 'oui' }) });
  const code2 = new URL(r.headers.get('location')).searchParams.get('code');
  r = await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: cl.client_id, code_verifier: v2 }) });
  assert.equal(r.status, 200);
  const jetons = await r.json(); assert.match(jetons.access_token, /^ava_/); assert.match(jetons.refresh_token, /^avr_/);

  // MCP : initialize, tools/list, tools/call
  const mcp = async (corps) => app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetons.access_token}` }, body: JSON.stringify(corps) });
  r = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(r.status, 200); const init = await r.json(); assert.equal(init.result.serverInfo.name, 'assistant-vocal');
  r = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(r.status, 202);
  const outils = (await (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools.map((t) => t.name);
  assert.ok(outils.includes('demander_assistant') && outils.includes('schedule_reminder') && outils.includes('notify_me'));
  const appel = await (await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'demander_assistant', arguments: { message: 'Bonjour' } } })).json();
  assert.equal(appel.result.isError, false); assert.match(appel.result.content[0].text, /Réponse de Claude/);
  const liste = await (await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_reminders', arguments: {} } })).json();
  assert.match(liste.result.content[0].text, /Aucun rappel/);
  const inconnu = await (await mcp({ jsonrpc: '2.0', id: 5, method: 'nimporte' })).json(); assert.equal(inconnu.error.code, -32601);

  // Rafraîchissement (rotation) puis révocation
  r = await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: jetons.refresh_token, client_id: cl.client_id }) });
  assert.equal(r.status, 200); const j2 = await r.json(); assert.notEqual(j2.access_token, jetons.access_token);
  r = await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: jetons.refresh_token, client_id: cl.client_id }) });
  assert.equal(r.status, 400, 'ancien refresh_token invalidé');
  await app.request('/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: j2.access_token }) });
  r = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j2.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }) });
  assert.equal(r.status, 401);
  const clients = await (await app.request('/api/mcp-serveur/clients', { headers: { cookie } })).json();
  assert.equal(clients.clients[0].client_name, 'Claude');
});
