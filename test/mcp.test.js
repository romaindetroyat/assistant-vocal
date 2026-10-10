import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserConfigMcp, parametresMcp, serveursDepuisVariables } from '../server/mcp.js';

test('config MCP → mcp_servers et un mcp_toolset par serveur', () => {
  const serveurs = analyserConfigMcp(JSON.stringify({
    servers: [
      { name: 'gmail', url: 'https://x.invalid/gmail', description: 'Mail', authorization_token_env: 'T_GMAIL' },
      { name: 'agenda', url: 'https://x.invalid/agenda', allowed_tools: ['lister_evenements'] },
      { name: 'off', url: 'https://x.invalid/off', enabled: false },
    ],
  }), { T_GMAIL: 'jeton' });
  assert.equal(serveurs.length, 2);
  const { mcp_servers, tools } = parametresMcp(serveurs);
  assert.deepEqual(mcp_servers[0], { type: 'url', url: 'https://x.invalid/gmail', name: 'gmail', authorization_token: 'jeton' });
  assert.deepEqual(mcp_servers[1], { type: 'url', url: 'https://x.invalid/agenda', name: 'agenda' });
  assert.deepEqual(tools[0], { type: 'mcp_toolset', mcp_server_name: 'gmail' });
  // Un serveur secondaire est chargé à la demande (defer_loading), un serveur d'agenda ou de courrier d'emblée.
  const { tools: t2 } = parametresMcp([{ name: 'vercel', url: 'https://v.test/mcp' }, { name: 'agenda', url: 'https://a.test/mcp' }]);
  assert.deepEqual(t2[0].default_config, { defer_loading: true });
  assert.equal(t2[1].default_config, undefined);
  assert.deepEqual(tools[1], { type: 'mcp_toolset', mcp_server_name: 'agenda', default_config: { enabled: false }, configs: { lister_evenements: { enabled: true } } });
});

test('config MCP invalide : erreurs explicites', () => {
  assert.throws(() => analyserConfigMcp('{'), /illisible/);
  assert.throws(() => analyserConfigMcp('{"servers":[{"name":"a","url":"http://x"}]}'), /https:/);
  assert.throws(() => analyserConfigMcp('{"servers":[{"name":"a","url":"https://x"},{"name":"a","url":"https://y"}]}'), /double/);
  assert.throws(() => analyserConfigMcp('{"servers":[{"name":"mauvais nom","url":"https://x"}]}'), /name/);
});

test('serveurs déclarés par variables MCP_URL_<NOM>', () => {
  const s = serveursDepuisVariables({ MCP_URL_ZAPIER: 'https://mcp.zapier.com/x', MCP_URL_AGENDA: 'https://a/mcp', MCP_TOKEN_AGENDA: 'jeton', MCP_DESC_AGENDA: 'Mon agenda', MCP_TOOLS_AGENDA: 'lister, creer', AUTRE: 'x' });
  assert.deepEqual(s.map((x) => x.name), ['agenda', 'zapier']);
  assert.equal(s[0].authorization_token, 'jeton');
  assert.equal(s[0].description, 'Mon agenda');
  assert.deepEqual(s[0].allowed_tools, ['lister', 'creer']);
  assert.match(s[1].description, /Gmail/);
  assert.equal(s[1].authorization_token, undefined);
});

test("serveurs ajoutés depuis l'application : validation, doublons, retrait", async () => {
  const { ajouterServeur, listerServeursAjoutes, retirerServeur } = await import('../server/mcp.js');
  const s = await ajouterServeur({ name: ' Mon Zapier ', url: 'https://mcp.zapier.com/api/mcp/s/x/mcp', description: '' });
  assert.equal(s.name, 'mon-zapier');
  assert.match(s.description, /mon-zapier/);
  await assert.rejects(() => ajouterServeur({ name: 'mon-zapier', url: 'https://x' }), /existe déjà/);
  await assert.rejects(() => ajouterServeur({ name: 'agenda', url: 'https://x' }, [{ name: 'agenda' }]), /existe déjà/);
  await assert.rejects(() => ajouterServeur({ name: 'a', url: 'http://x' }), /https/);
  assert.equal((await listerServeursAjoutes()).length, 1);
  assert.equal(await retirerServeur('mon-zapier'), true);
  assert.equal(await retirerServeur('mon-zapier'), false);
});
