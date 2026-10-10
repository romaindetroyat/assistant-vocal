// Génère server/assets-inline.js : les fichiers de public/ embarqués dans le bundle du Worker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossier = path.join(racine, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function lister(d, prefixe = '') {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? lister(path.join(d, e.name), `${prefixe}/${e.name}`) : [`${prefixe}/${e.name}`]));
}
const fichiers = {};
for (const chemin of lister(dossier)) {
  const ext = path.extname(chemin);
  fichiers[chemin] = { type: types[ext] || 'application/octet-stream', base64: fs.readFileSync(path.join(dossier, chemin)).toString('base64') };
}
// Version lue dans package.json ; date de déploiement = DEPLOYED_AT ou l'heure du build (aucune avec --dev).
const { version } = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
const infosBuild = { version, deployeLe: process.argv.includes('--dev') ? null : process.env.DEPLOYED_AT || new Date().toISOString() };
const sortie = `// Fichier généré par scripts/inline-assets.mjs — ne pas modifier.\nexport const infosBuild = ${JSON.stringify(infosBuild)};\nexport const fichiersInline = ${JSON.stringify(fichiers)};\n`;
fs.writeFileSync(path.join(racine, 'server', 'assets-inline.js'), sortie);
console.log(`Version ${infosBuild.version} (${infosBuild.deployeLe || 'dev'}) · ${Object.keys(fichiers).length} fichiers embarqués (${(sortie.length / 1024).toFixed(0)} Ko)`);
