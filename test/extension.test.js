import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { creerJeton as creerJetonAppareil } from '../server/jetons.js';
import { ecrireValeur, listerConversations, supprimerConversation } from '../server/store.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerZip, listerZip, zipExtension } from '../scripts/extension-zip.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossierExtension = path.join(racine, 'extension');
const ORIGINE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function clientSimule(texte) {
  return { beta: { messages: { stream() {
    const reponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: texte }] };
    const evenements = [{ type: 'content_block_start', content_block: reponse.content[0] }, { type: 'content_block_delta', delta: { type: 'text_delta', text: texte } }];
    return { async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; }, async finalMessage() { return reponse; } };
  } } } };
}

test('CORS extension : préflight 204 avec en-têtes pour chrome-extension://, rien pour une autre origine', async () => {
  const app = creerApplication({ client: {}, serveurs: [] });
  for (const route of ['/api/partage', '/api/raccourci']) {
    const r = await app.request(route, { method: 'OPTIONS', headers: { Origin: ORIGINE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
    assert.equal(r.status, 204, `${route} : préflight sans authentification`);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGINE);
    assert.equal(r.headers.get('vary'), 'Origin');
    assert.equal(r.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
    assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  }
  // Firefox : même traitement
  let r = await app.request('/api/partage', { method: 'OPTIONS', headers: { Origin: 'moz-extension://0123-4567' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'moz-extension://0123-4567');
  // Autre origine : préflight sans aucun en-tête CORS
  r = await app.request('/api/partage', { method: 'OPTIONS', headers: { Origin: 'https://autre.site' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('access-control-allow-headers'), null);
  // Origine d'extension mal formée : refusée aussi
  r = await app.request('/api/partage', { method: 'OPTIONS', headers: { Origin: 'chrome-extension://abc/evil' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  // Les autres routes à session ne reçoivent pas de CORS
  r = await app.request('/api/conversations', { method: 'OPTIONS', headers: { Origin: ORIGINE } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('CORS extension : POST avec jeton et Origin renvoie l\'en-tête ; 401 porte aussi l\'en-tête ; sans Origin, rien', async () => {
  for (const c of await listerConversations()) await supprimerConversation(c.id);
  await ecrireValeur('jetons-appareils', []);
  const { jeton } = await creerJetonAppareil('Chrome');
  const app = creerApplication({ client: () => clientSimule('Bonjour toi !'), serveurs: [] });
  const poster = (route, corps, headers = {}) => app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corps) });

  let r = await poster('/api/partage', { texte: 'Page envoyée par l\'extension', url: 'https://exemple.fr', consigne: '' }, { Origin: ORIGINE, Authorization: `Bearer ${jeton}` });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGINE);
  assert.equal(r.headers.get('vary'), 'Origin');
  assert.equal((await r.json()).texte, 'Bonjour toi !');

  r = await poster('/api/raccourci', { texte: 'Dis bonjour en trois mots' }, { Origin: ORIGINE, Authorization: `Bearer ${jeton}` });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGINE);

  // Jeton refusé : l'extension doit pouvoir lire le 401 (en-tête présent)
  r = await poster('/api/raccourci', { texte: 'x' }, { Origin: ORIGINE, Authorization: `Bearer ${'f'.repeat(64)}` });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGINE);

  r = await poster('/api/raccourci', { texte: 'x' }, { Origin: 'https://autre.site', Authorization: `Bearer ${jeton}` });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await poster('/api/raccourci', { texte: 'x' }, { Authorization: `Bearer ${jeton}` });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('manifeste : MV3 valide, trois commandes, permissions, icônes et fichiers référencés présents', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(dossierExtension, 'manifest.json'), 'utf8'));
  assert.equal(manifeste.manifest_version, 3);
  assert.equal(manifeste.name, 'Assistant vocal');
  assert.match(manifeste.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(manifeste.commands).sort(), ['envoyer-page', 'ouvrir', 'parler']);
  for (const [nom, cmd] of Object.entries(manifeste.commands)) {
    assert.ok(cmd.description, `${nom} : description`);
    assert.match(cmd.suggested_key.default, /^Ctrl\+Shift\+(Space|[A-Z])$/, `${nom} : touche par défaut`);
    assert.match(cmd.suggested_key.mac, /^MacCtrl\+Shift\+/, `${nom} : touche Mac`);
  }
  assert.equal(manifeste.commands.parler.suggested_key.default, 'Ctrl+Shift+Space');
  assert.equal(manifeste.commands['envoyer-page'].suggested_key.default, 'Ctrl+Shift+E');
  assert.equal(manifeste.commands.ouvrir.suggested_key.default, 'Ctrl+Shift+A');
  for (const p of ['contextMenus', 'storage', 'tabs', 'scripting', 'windows', 'notifications']) assert.ok(manifeste.permissions.includes(p), `permission ${p}`);
  assert.deepEqual(manifeste.host_permissions, ['https://assistant-vocal.romaindetroyat.workers.dev/*']);
  assert.equal(manifeste.background.service_worker, 'background.js');
  assert.equal(manifeste.background.type, 'module');
  assert.equal(manifeste.options_page, 'options.html');
  assert.equal(manifeste.action.default_popup, 'popup.html');
  const references = [manifeste.background.service_worker, manifeste.options_page, manifeste.action.default_popup, ...Object.values(manifeste.icons), ...Object.values(manifeste.action.default_icon)];
  for (const f of references) assert.ok(fs.existsSync(path.join(dossierExtension, f)), `fichier référencé ${f}`);
  // Les PNG sont de vrais PNG aux bonnes dimensions
  for (const [taille, fichier] of Object.entries(manifeste.icons)) {
    const png = fs.readFileSync(path.join(dossierExtension, fichier));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', `${fichier} : signature PNG`);
    assert.equal(png.readUInt32BE(16), Number(taille), `${fichier} : largeur`);
    assert.equal(png.readUInt32BE(20), Number(taille), `${fichier} : hauteur`);
  }
});

test('scripts de l\'extension : syntaxe vérifiée par node --check, pas de strict: true, hôte par défaut cohérent', () => {
  const scripts = fs.readdirSync(dossierExtension).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.includes('background.js') && scripts.includes('options.js') && scripts.includes('popup.js'));
  for (const f of scripts) assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(dossierExtension, f)], { stdio: 'pipe' }), `node --check ${f}`);
  const reglages = fs.readFileSync(path.join(dossierExtension, 'reglages.js'), 'utf8');
  assert.ok(reglages.includes("'https://assistant-vocal.romaindetroyat.workers.dev'"), "hôte par défaut = production, identique à host_permissions");
  const background = fs.readFileSync(path.join(dossierExtension, 'background.js'), 'utf8');
  assert.ok(background.includes('/api/partage') && background.includes('action=appel') && background.includes('chrome.windows.create'));
  assert.ok(!background.includes('strict: true'));
  // L'extension n'est pas embarquée dans le Worker : inline-assets ne lit que public/
  const inline = fs.readFileSync(path.join(racine, 'scripts', 'inline-assets.mjs'), 'utf8');
  assert.ok(inline.includes("'public'") && !inline.includes('extension'));
});

test('zip de l\'extension : format stored lisible, manifest.json à la racine, tous les fichiers du dossier', () => {
  const zip = zipExtension();
  assert.equal(zip.toString('hex', 0, 4), '504b0304', 'signature d\'entrée locale');
  const entrees = listerZip(zip);
  const noms = entrees.map((e) => e.nom);
  assert.ok(noms.includes('manifest.json') && noms.includes('background.js') && noms.includes('icons/icon-128.png'), noms.join(', '));
  assert.ok(!noms.some((n) => n.startsWith('extension/')), 'pas de dossier parent dans le zip');
  const manifeste = entrees.find((e) => e.nom === 'manifest.json');
  assert.equal(manifeste.taille, fs.statSync(path.join(dossierExtension, 'manifest.json')).size);
  // Mini zip construit à la main : contenu relisible à l'offset annoncé
  const mini = creerZip([{ nom: 'a.txt', contenu: Buffer.from('bonjour'), date: new Date(2026, 9, 10, 12, 0, 0) }]);
  const [a] = listerZip(mini);
  assert.equal(a.nom, 'a.txt'); assert.equal(a.taille, 7);
  assert.equal(mini.toString('utf8', 30 + 5, 30 + 5 + 7), 'bonjour');
  assert.equal(listerZip(creerZip([{ nom: 'x', contenu: Buffer.from('123456789') }]))[0].crc, 0xcbf43926, 'CRC-32 de « 123456789 »');
});
