// Jetons d'appareil : secrets longs pour les raccourcis iOS (partage, Siri) qui ne peuvent pas porter le cookie de session.
// Le jeton n'est affiché qu'à la création ; seul son hachage SHA-256 est stocké.
import { lireValeur, ecrireValeur } from './store.js';

const CLE = 'jetons-appareils';
const hex = (octets) => [...octets].map((b) => b.toString(16).padStart(2, '0')).join('');
const aleatoire = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256hex = async (s) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

const lireTous = async () => (await lireValeur(CLE)) || [];
const sansHash = ({ hash, ...reste }) => reste;

// Crée un jeton nommé. Retourne { id, nom, jeton } : le jeton en clair n'est jamais conservé.
export async function creerJeton(nom) {
  const propre = String(nom || '').trim().slice(0, 60);
  if (!propre) throw new Error("Nom de l'appareil requis");
  const jeton = aleatoire(32);
  const entree = { id: aleatoire(8), nom: propre, hash: await sha256hex(jeton), creeLe: new Date().toISOString(), dernierUsage: null };
  await ecrireValeur(CLE, [...(await lireTous()), entree]);
  return { id: entree.id, nom: entree.nom, jeton };
}

// Vérifie un jeton présenté : entrée (sans hash) ou null. Met à jour la date de dernier usage.
export async function verifierJeton(jeton) {
  if (typeof jeton !== 'string' || !/^[0-9a-f]{64}$/.test(jeton)) return null;
  const h = await sha256hex(jeton);
  const tous = await lireTous();
  const entree = tous.find((e) => e.hash === h);
  if (!entree) return null;
  entree.dernierUsage = new Date().toISOString();
  await ecrireValeur(CLE, tous);
  return sansHash(entree);
}

export async function revoquerJeton(id) {
  const tous = await lireTous();
  const restants = tous.filter((e) => e.id !== id);
  if (restants.length === tous.length) return false;
  await ecrireValeur(CLE, restants);
  return true;
}

export async function listerJetons() {
  return (await lireTous()).map(sansHash);
}

// Extrait le jeton d'un en-tête « Authorization: Bearer … ».
export function jetonDepuisEntete(entete) {
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(String(entete || '').trim());
  return m ? m[1].toLowerCase() : null;
}
