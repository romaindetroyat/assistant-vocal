import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserConfigMcp, parametresMcp } from '../server/mcp.js';

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
  assert.deepEqual(tools[1], { type: 'mcp_toolset', mcp_server_name: 'agenda', default_config: { enabled: false }, configs: { lister_evenements: { enabled: true } } });
});

test('config MCP invalide : erreurs explicites', () => {
  assert.throws(() => analyserConfigMcp('{'), /illisible/);
  assert.throws(() => analyserConfigMcp('{"servers":[{"name":"a","url":"http://x"}]}'), /https:/);
  assert.throws(() => analyserConfigMcp('{"servers":[{"name":"a","url":"https://x"},{"name":"a","url":"https://y"}]}'), /double/);
  assert.throws(() => analyserConfigMcp('{"servers":[{"name":"mauvais nom","url":"https://x"}]}'), /name/);
});
