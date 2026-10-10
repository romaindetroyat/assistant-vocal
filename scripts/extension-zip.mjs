// Empaquette extension/ dans dist/assistant-extension.zip sans dépendance : format zip « stored » (aucune compression,
// les fichiers sont petits) avec CRC-32, entêtes locaux, répertoire central et fin de répertoire.
// Usage : node scripts/extension-zip.mjs [sortie.zip]   (export `creerZip` réutilisé par les tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tableCrc = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = tableCrc[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function lister(dossier, prefixe = '') {
  return fs.readdirSync(dossier, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    return e.isDirectory() ? lister(path.join(dossier, e.name), `${prefixe}${e.name}/`) : [`${prefixe}${e.name}`];
  });
}

// Date/heure MS-DOS (résolution 2 s) à partir d'un Date.
function dateDos(d) {
  const heure = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { heure, date };
}

// Construit le zip en mémoire : [{ nom, contenu: Buffer, date? }] → Buffer. Entrées « stored » (méthode 0).
export function creerZip(entrees) {
  const locaux = [], central = [];
  let decalage = 0;
  for (const { nom, contenu, date = new Date() } of entrees) {
    const nomBuf = Buffer.from(nom, 'utf8');
    const crc = crc32(contenu);
    const { heure, date: jour } = dateDos(date);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // version 2.0, noms UTF-8
    local.writeUInt16LE(0, 8); local.writeUInt16LE(heure, 10); local.writeUInt16LE(jour, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(contenu.length, 18); local.writeUInt32LE(contenu.length, 22);
    local.writeUInt16LE(nomBuf.length, 26); local.writeUInt16LE(0, 28);
    const entreeCentrale = Buffer.alloc(46);
    entreeCentrale.writeUInt32LE(0x02014b50, 0); entreeCentrale.writeUInt16LE(20, 4); entreeCentrale.writeUInt16LE(20, 6); entreeCentrale.writeUInt16LE(0x0800, 8);
    entreeCentrale.writeUInt16LE(0, 10); entreeCentrale.writeUInt16LE(heure, 12); entreeCentrale.writeUInt16LE(jour, 14);
    entreeCentrale.writeUInt32LE(crc, 16); entreeCentrale.writeUInt32LE(contenu.length, 20); entreeCentrale.writeUInt32LE(contenu.length, 24);
    entreeCentrale.writeUInt16LE(nomBuf.length, 28); entreeCentrale.writeUInt16LE(0, 30); entreeCentrale.writeUInt16LE(0, 32);
    entreeCentrale.writeUInt16LE(0, 34); entreeCentrale.writeUInt16LE(0, 36); entreeCentrale.writeUInt32LE(0, 38); entreeCentrale.writeUInt32LE(decalage, 42);
    locaux.push(local, nomBuf, contenu);
    central.push(entreeCentrale, nomBuf);
    decalage += local.length + nomBuf.length + contenu.length;
  }
  const corpsCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(0, 4); fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(corpsCentral.length, 12); fin.writeUInt32LE(decalage, 16); fin.writeUInt16LE(0, 20);
  return Buffer.concat([...locaux, corpsCentral, fin]);
}

// Liste les entrées du répertoire central d'un zip (vérification / tests) : [{ nom, taille, crc }].
export function listerZip(buf) {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error('Fin de répertoire introuvable');
  const nombre = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entrees = [];
  for (let i = 0; i < nombre; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Entrée centrale invalide');
    const longNom = buf.readUInt16LE(p + 28), longExtra = buf.readUInt16LE(p + 30), longComm = buf.readUInt16LE(p + 32);
    entrees.push({ nom: buf.toString('utf8', p + 46, p + 46 + longNom), taille: buf.readUInt32LE(p + 24), crc: buf.readUInt32LE(p + 16) });
    p += 46 + longNom + longExtra + longComm;
  }
  return entrees;
}

// Zip du dossier extension/ : noms relatifs à la racine du dossier (manifest.json à la racine du zip, comme Chrome l'attend).
export function zipExtension(dossier = path.join(racine, 'extension')) {
  return creerZip(lister(dossier).map((nom) => ({ nom, contenu: fs.readFileSync(path.join(dossier, nom)), date: fs.statSync(path.join(dossier, nom)).mtime })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sortie = path.resolve(process.argv[2] || path.join(racine, 'dist', 'assistant-extension.zip'));
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  const zip = zipExtension();
  fs.writeFileSync(sortie, zip);
  console.log(`${sortie} : ${listerZip(zip).length} fichiers, ${(zip.length / 1024).toFixed(0)} Ko`);
}
