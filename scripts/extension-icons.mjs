// Génère les icônes PNG de l'extension (16, 48, 128 px) sans dépendance : disque bleu sur fond transparent
// avec un micro blanc stylisé. Encodage PNG minimal (RGBA, filtre « none », zlib de Node, CRC-32 maison).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
const TAILLES = [16, 48, 128];
const FOND = [37, 99, 235]; // bleu #2563eb, comme l'icône de la PWA

const tableCrc = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = tableCrc[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const long = Buffer.alloc(4); long.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([long, corps, crc]);
}

// Pixel (x, y) d'une icône de taille n : disque plein, micro = capsule verticale blanche + arc + pied.
function pixel(x, y, n) {
  const cx = (n - 1) / 2, cy = (n - 1) / 2, r = n / 2 - 0.5;
  const d = Math.hypot(x - cx, y - cy);
  if (d > r) return [0, 0, 0, 0];
  const alpha = d > r - 1 ? Math.round(255 * (r - d)) : 255; // bord adouci
  const lx = (x - cx) / n, ly = (y - cy) / n; // coordonnées normalisées dans [-0.5, 0.5]
  if (n >= 48) {
    const capsule = (Math.abs(lx) < 0.09 && ly > -0.22 && ly < 0.02) || Math.hypot(lx, ly + 0.22) < 0.09 || Math.hypot(lx, ly - 0.02) < 0.09;
    const arc = Math.abs(Math.hypot(lx, ly - 0.02) - 0.17) < 0.025 && ly > 0.02;
    const pied = (Math.abs(lx) < 0.02 && ly >= 0.17 && ly < 0.27) || (Math.abs(lx) < 0.11 && Math.abs(ly - 0.27) < 0.02);
    if (capsule || arc || pied) return [255, 255, 255, alpha];
  } else if (Math.abs(lx) < 0.1 && ly > -0.26 && ly < 0.14) return [255, 255, 255, alpha];
  return [...FOND, alpha];
}

function png(n) {
  const ligne = n * 4 + 1;
  const brut = Buffer.alloc(ligne * n);
  for (let y = 0; y < n; y++) {
    brut[y * ligne] = 0; // filtre « none »
    for (let x = 0; x < n; x++) brut.set(pixel(x, y, n), y * ligne + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits par canal, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(brut, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(dossier, { recursive: true });
for (const n of TAILLES) fs.writeFileSync(path.join(dossier, `icon-${n}.png`), png(n));
console.log(`Icônes générées dans ${dossier} : ${TAILLES.map((n) => `${n} px`).join(', ')}`);
