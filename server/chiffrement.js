// Chiffrement du coffre de documents : AES-256-GCM via WebCrypto (Node 22 et Cloudflare Workers).
// Clé : secret DOCS_KEY (32 octets en hexadécimal) s'il existe, sinon dérivée de SESSION_SECRET par HKDF-SHA256.
// La clé ne quitte jamais le serveur ; chaque chiffrement tire un IV aléatoire de 12 octets.
import { config } from './config.js';

const subtle = () => globalThis.crypto.subtle;
const TAILLE_IV = 12;
const SEL = 'assistant-vocal';
const INFO = 'coffre-documents';
const HEX_CLE = /^[0-9a-f]{64}$/i;

let cache = { source: null, promesse: null };

function sourceCle() {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const docsKey = String(env.DOCS_KEY || '').trim();
  if (docsKey) {
    if (!HEX_CLE.test(docsKey)) throw new Error('DOCS_KEY doit être une clé de 32 octets en hexadécimal (64 caractères)');
    return { type: 'hex', valeur: docsKey.toLowerCase() };
  }
  const secret = config.sessionSecret;
  if (!secret) throw new Error('Chiffrement impossible : définissez DOCS_KEY ou SESSION_SECRET');
  return { type: 'hkdf', valeur: secret };
}

function hexVersOctets(hex) {
  const sortie = new Uint8Array(hex.length / 2);
  for (let i = 0; i < sortie.length; i++) sortie[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return sortie;
}

async function importerCle(source) {
  const brut = source.type === 'hex'
    ? hexVersOctets(source.valeur)
    : await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(SEL), info: new TextEncoder().encode(INFO) },
      await subtle().importKey('raw', new TextEncoder().encode(source.valeur), 'HKDF', false, ['deriveBits']),
      256,
    );
  return subtle().importKey('raw', brut, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Clé AES-GCM (CryptoKey), mise en cache tant que la source ne change pas.
export function cle() {
  const source = sourceCle();
  const empreinte = `${source.type}:${source.valeur}`;
  if (cache.source !== empreinte) cache = { source: empreinte, promesse: importerCle(source) };
  return cache.promesse;
}

// Empreinte hexadécimale de la clé (pour les tests : vérifier la stabilité de la dérivation, sans exposer la clé).
export async function empreinteCle() {
  const source = sourceCle();
  const brut = source.type === 'hex'
    ? hexVersOctets(source.valeur)
    : new Uint8Array(await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(SEL), info: new TextEncoder().encode(INFO) },
      await subtle().importKey('raw', new TextEncoder().encode(source.valeur), 'HKDF', false, ['deriveBits']),
      256,
    ));
  const hash = new Uint8Array(await subtle().digest('SHA-256', brut));
  return [...hash].map((o) => o.toString(16).padStart(2, '0')).join('');
}

export function versBase64(octets) {
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}
export function depuisBase64(texte) {
  return Uint8Array.from(atob(String(texte || '')), (ch) => ch.charCodeAt(0));
}

const enOctets = (donnees) => (donnees instanceof Uint8Array ? donnees : donnees instanceof ArrayBuffer ? new Uint8Array(donnees) : new TextEncoder().encode(String(donnees)));

// Chiffre des octets ; renvoie { iv (base64), donnees (Uint8Array) }.
export async function chiffrer(donnees) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(TAILLE_IV));
  const chiffre = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await cle(), enOctets(donnees)));
  return { iv: versBase64(iv), donnees: chiffre };
}

// Déchiffre { iv (base64 ou Uint8Array), donnees (Uint8Array, ArrayBuffer ou base64) } ; renvoie des octets.
export async function dechiffrer({ iv, donnees }) {
  const vecteur = typeof iv === 'string' ? depuisBase64(iv) : enOctets(iv);
  const corps = typeof donnees === 'string' ? depuisBase64(donnees) : enOctets(donnees);
  try { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: vecteur }, await cle(), corps)); }
  catch { throw new Error('Déchiffrement impossible : clé différente ou données altérées'); }
}

// Format du blob stocké : 12 octets d'IV suivis du chiffré.
export async function chiffrerBlob(donnees) {
  const { iv, donnees: chiffre } = await chiffrer(donnees);
  const vecteur = depuisBase64(iv);
  const sortie = new Uint8Array(vecteur.length + chiffre.length);
  sortie.set(vecteur, 0); sortie.set(chiffre, vecteur.length);
  return sortie;
}
export async function dechiffrerBlob(octets) {
  const o = enOctets(octets);
  if (o.length <= TAILLE_IV) throw new Error('Blob chiffré invalide');
  return dechiffrer({ iv: o.subarray(0, TAILLE_IV), donnees: o.subarray(TAILLE_IV) });
}

// Variantes chaîne : « iv.donnees » en base64, pratiques pour une valeur de fiche JSON.
export async function chiffrerTexte(texte) {
  const { iv, donnees } = await chiffrer(String(texte ?? ''));
  return `${iv}.${versBase64(donnees)}`;
}
export async function dechiffrerTexte(chaine) {
  const [iv, donnees] = String(chaine || '').split('.');
  if (!iv || !donnees) throw new Error('Texte chiffré invalide');
  return new TextDecoder().decode(await dechiffrer({ iv, donnees }));
}
