import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executerOutilDev, devDisponible } from '../server/dev.js';
import { outilsLocauxDisponibles } from '../server/tools.js';

test("demander_developpement : absent sans jeton, crée une issue @claude avec jeton", async () => {
  delete process.env.GITHUB_TOKEN;
  assert.equal(devDisponible(), false);
  assert.ok(!(await outilsLocauxDisponibles()).some((t) => t.name === 'demander_developpement'));
  process.env.GITHUB_TOKEN = 'ghp_test';
  assert.ok((await outilsLocauxDisponibles()).some((t) => t.name === 'demander_developpement'));
  let requete;
  const f = async (url, init) => { requete = { url, init }; return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/romaindetroyat/assistant-vocal/issues/42' }), { status: 201 }); };
  const r = await executerOutilDev({ titre: 'Mode sombre forcé', description: 'Ajouter un réglage pour forcer le thème sombre.' }, f);
  assert.match(r, /issue #42/);
  assert.equal(requete.url, 'https://api.github.com/repos/romaindetroyat/assistant-vocal/issues');
  const corps = JSON.parse(requete.init.body);
  assert.equal(corps.title, 'Mode sombre forcé'); assert.match(corps.body, /^@claude/); assert.match(corps.body, /thème sombre/);
  delete process.env.GITHUB_TOKEN;
});
