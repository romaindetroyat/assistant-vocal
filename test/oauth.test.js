import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerConnexion, terminerConnexion, jetonPour, etatConnexion, deconnecter, extraireCodeEtState } from '../server/oauth-mcp.js';
import { resoudreServeurs } from '../server/mcp.js';

// Serveur OAuth simulé qui refuse l'adresse de retour du Worker (comme Agenda Hub).
function fetchSimule(journal, { refuseWorker = true, expiresIn = 3600 } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    journal.push({ url: u, method: init.method || 'GET', body: init.body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/.well-known/oauth-protected-resource/api/mcp')) return json({ resource: 'https://hub.test/api/mcp', authorization_servers: ['https://hub.test'], scopes_supported: ['agenda'] });
    if (u.endsWith('/.well-known/oauth-authorization-server')) return json({ issuer: 'https://hub.test', authorization_endpoint: 'https://hub.test/oauth/authorize', token_endpoint: 'https://hub.test/api/oauth/token', registration_endpoint: 'https://hub.test/api/oauth/register', revocation_endpoint: 'https://hub.test/api/oauth/revoke', code_challenge_methods_supported: ['S256'] });
    if (u.endsWith('/api/oauth/register')) {
      const corps = JSON.parse(init.body);
      if (refuseWorker && !corps.redirect_uris[0].startsWith('http://localhost')) return json({ error: 'invalid_redirect_uri', error_description: 'non admise' }, 400);
      return json({ client_id: `cid-${corps.redirect_uris[0].includes('localhost') ? 'local' : 'worker'}`, redirect_uris: corps.redirect_uris });
    }
    if (u.endsWith('/api/oauth/token')) {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') { assert.equal(p.get('code'), 'CODE1'); assert.ok(p.get('code_verifier')); return json({ access_token: 'AT1', refresh_token: 'RT1', expires_in: expiresIn }); }
      if (p.get('grant_type') === 'refresh_token') { assert.equal(p.get('refresh_token'), 'RT1'); return json({ access_token: 'AT2', expires_in: 3600 }); }
    }
    if (u.endsWith('/api/oauth/revoke')) return new Response(null, { status: 200 });
    return new Response('404', { status: 404 });
  };
}

test('OAuth MCP : repli localhost, PKCE, échange du code, jeton, rafraîchissement, déconnexion', async () => {
  const journal = [];
  const f = fetchSimule(journal, { expiresIn: 30 }); // expire dans 30 s → rafraîchi au premier usage
  const { url, manuel } = await demarrerConnexion({ nom: 'hub', urlMcp: 'https://hub.test/api/mcp', redirectUri: 'https://w.test/oauth/callback' }, f);
  assert.equal(manuel, true);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://hub.test/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'cid-local');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:3000/oauth/callback');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('scope'), 'agenda');
  const state = u.searchParams.get('state');
  assert.equal((await etatConnexion('hub')).connecte, false);

  await assert.rejects(() => terminerConnexion({ nom: 'hub', code: 'CODE1', state: 'faux' }, f), /state/);
  const retour = extraireCodeEtState(`http://localhost:3000/oauth/callback?code=CODE1&state=${state}`);
  await terminerConnexion({ nom: 'hub', ...retour }, f);
  assert.equal((await etatConnexion('hub')).connecte, true);
  assert.equal(await jetonPour('hub', f), 'AT2', 'jeton proche de l\'expiration → rafraîchi');
  assert.equal(await jetonPour('hub', f), 'AT2', 'puis réutilisé');

  const { prets, nonConnectes } = await resoudreServeurs([{ name: 'hub', url: 'https://hub.test/api/mcp', auth: 'oauth' }, { name: 'z', url: 'https://z', auth: 'token' }, { name: 'autre', url: 'https://a', auth: 'oauth' }], (n) => jetonPour(n, f));
  assert.deepEqual(prets.map((s) => [s.name, s.authorization_token]), [['hub', 'AT2'], ['z', undefined]]);
  assert.deepEqual(nonConnectes.map((s) => s.name), ['autre']);

  await deconnecter('hub', f);
  assert.equal((await etatConnexion('hub')).connecte, false);
  assert.ok(journal.some((j) => j.url.endsWith('/api/oauth/revoke')));
});

test('OAuth MCP : adresse de retour acceptée → pas de mode manuel', async () => {
  const f = fetchSimule([], { refuseWorker: false });
  const { url, manuel } = await demarrerConnexion({ nom: 'hub2', urlMcp: 'https://hub.test/api/mcp', redirectUri: 'https://w.test/oauth/callback' }, f);
  assert.equal(manuel, false);
  assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://w.test/oauth/callback');
});
