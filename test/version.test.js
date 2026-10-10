import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creerApplication } from '../server/app.js';
import { creerApplicationNode } from '../server/index.js';
import { infosBuild, formaterVersion } from '../server/version.js';

const paquet = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

async function connecter(app) {
  const r = await app.request('/api/login', { method: 'POST', body: JSON.stringify({ password: 'secret-de-test' }), headers: { 'Content-Type': 'application/json' } });
  return { cookie: r.headers.get('set-cookie').split(';')[0] };
}

test('formaterVersion : date de déploiement en heure de Paris, au format français', () => {
  // Heure d'été (UTC+2) puis heure d'hiver (UTC+1).
  assert.equal(formaterVersion({ version: '1.4.2', deployeLe: '2026-10-10T02:54:00Z' }), 'Version 1.4.2 · déployée le 10/10/2026 à 04:54');
  assert.equal(formaterVersion({ version: '1.4.2', deployeLe: '2026-01-05T23:05:00Z' }), 'Version 1.4.2 · déployée le 06/01/2026 à 00:05');
});

test('formaterVersion : sans date (ou date invalide), mention « dev »', () => {
  assert.equal(formaterVersion({ version: '1.4.2' }), 'Version 1.4.2 · dev');
  assert.equal(formaterVersion({ version: '1.4.2', deployeLe: null }), 'Version 1.4.2 · dev');
  assert.equal(formaterVersion({ version: '1.4.2', deployeLe: 'pas une date' }), 'Version 1.4.2 · dev');
});

test('infosBuild : version lue dans package.json, date depuis DEPLOYED_AT', () => {
  assert.deepEqual(infosBuild({ deployeLe: '' }), { version: paquet.version, deployeLe: null });
  assert.deepEqual(infosBuild({ deployeLe: '2026-10-10T02:54:00Z' }), { version: paquet.version, deployeLe: '2026-10-10T02:54:00Z' });
});

test('/api/version : protégé par la session, renvoie la ligne à afficher', async () => {
  const app = creerApplication({ client: {}, serveurs: [], fichier: () => new Response(''), version: { version: '1.4.2', deployeLe: '2026-10-10T02:54:00Z' } });
  assert.equal((await app.request('/api/version')).status, 401);
  const r = await app.request('/api/version', { headers: await connecter(app) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { version: '1.4.2', deployeLe: '2026-10-10T02:54:00Z', texte: 'Version 1.4.2 · déployée le 10/10/2026 à 04:54' });
});

test('/api/version côté Node : version du package.json, « dev » sans DEPLOYED_AT', async () => {
  delete process.env.DEPLOYED_AT;
  const app = creerApplicationNode({ client: {}, serveurs: [] });
  const json = await (await app.request('/api/version', { headers: await connecter(app) })).json();
  assert.equal(json.version, paquet.version);
  assert.equal(json.texte, `Version ${paquet.version} · dev`);
});

test('la page « Mes outils » affiche la version en pied de page', () => {
  const html = fs.readFileSync(new URL('../public/outils.html', import.meta.url), 'utf8');
  assert.match(html, /<footer id="version" class="discret pied-version"><\/footer>\s*<\/main>/);
  assert.match(html, /api\('\/api\/version'\)/);
});
