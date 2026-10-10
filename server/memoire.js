// Mémoire de personnalisation : faits durables sur l'utilisateur (préférences, personnes, projets, habitudes),
// notés par l'assistant lui-même au fil des échanges, injectés dans le prompt.
import { lireValeur, ecrireValeur } from './store.js';

export const CATEGORIES = ['preference', 'personne', 'projet', 'habitude', 'fait'];
const MAX = 150;
const id = () => Math.random().toString(36).slice(2, 8);

export const lireMemoire = async () => (await lireValeur('memoire')) || [];
async function sauver(l) { await ecrireValeur('memoire', l); }

export async function noter({ categorie, texte, cle }) {
  const cat = CATEGORIES.includes(categorie) ? categorie : 'fait';
  const t = String(texte || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!t) throw new Error('Texte vide');
  const k = String(cle || '').trim().toLowerCase().slice(0, 60);
  const liste = await lireMemoire();
  const maintenant = new Date().toISOString();
  // Même clé (ex. « café », « kevin ») → mise à jour plutôt que doublon ; même texte → ignoré.
  const existant = liste.find((m) => (k && m.cle === k && m.categorie === cat) || m.texte.toLowerCase() === t.toLowerCase());
  if (existant) { existant.texte = t; existant.cle = k || existant.cle; existant.majLe = maintenant; existant.vu = (existant.vu || 0) + 1; }
  else liste.push({ id: id(), categorie: cat, cle: k || undefined, texte: t, creeLe: maintenant, majLe: maintenant, vu: 1 });
  while (liste.length > MAX) { liste.sort((a, b) => (a.majLe < b.majLe ? -1 : 1)); liste.shift(); }
  await sauver(liste);
  return liste.length;
}
export async function oublier(quoi) {
  const q = String(quoi || '').toLowerCase().trim();
  if (!q) throw new Error('Précise quoi oublier');
  const liste = await lireMemoire();
  const reste = liste.filter((m) => m.id !== q && !m.texte.toLowerCase().includes(q) && m.cle !== q);
  if (reste.length === liste.length) throw new Error('Rien ne correspond dans la mémoire');
  await sauver(reste);
  return liste.length - reste.length;
}
export async function chercher(q) {
  const s = String(q || '').toLowerCase();
  return (await lireMemoire()).filter((m) => !s || m.texte.toLowerCase().includes(s) || (m.cle || '').includes(s) || m.categorie.includes(s));
}
export async function remplacerMemoire(entrees) { await sauver(entrees.slice(0, MAX)); }

// Bloc injecté dans le prompt système.
export function blocProfil(memoire) {
  if (!memoire.length) return '';
  const libelles = { preference: 'Préférences', personne: 'Personnes', projet: 'Projets', habitude: 'Habitudes', fait: 'À savoir' };
  const parCat = {};
  for (const m of memoire) (parCat[m.categorie] ||= []).push(m.texte);
  return `## Ce que tu sais de l'utilisateur (mémoire)\n${CATEGORIES.filter((c) => parCat[c]).map((c) => `${libelles[c]} : ${parCat[c].join(' · ')}`).join('\n')}\n`;
}

export const definitionsOutilsMemoire = [
  { name: 'memoire_noter', description: "Note un fait durable sur l'utilisateur dès qu'il le révèle, SANS attendre qu'on te le demande : une préférence (café, horaires, style), une personne (rôle, lien), un projet en cours, une habitude. Pas les détails éphémères. Utilise une clé stable (ex. « kevin », « cafe ») pour mettre à jour au lieu de dupliquer.", strict: true,
    input_schema: { type: 'object', properties: { categorie: { type: 'string', enum: CATEGORIES, description: 'preference | personne | projet | habitude | fait' }, cle: { type: 'string', description: 'Mot-clé court et stable (ex. kevin, cafe, exail) ; chaîne vide si aucun' }, texte: { type: 'string', description: 'Le fait, en une phrase à la troisième personne' } }, required: ['categorie', 'cle', 'texte'], additionalProperties: false } },
  { name: 'memoire_chercher', description: 'Cherche dans la mémoire de personnalisation (texte vide = tout lister).', strict: true, input_schema: { type: 'object', properties: { recherche: { type: 'string' } }, required: ['recherche'], additionalProperties: false } },
  { name: 'memoire_oublier', description: 'Efface un ou plusieurs souvenirs (par mot-clé ou extrait).', strict: true, input_schema: { type: 'object', properties: { quoi: { type: 'string' } }, required: ['quoi'], additionalProperties: false } },
];
export const nomsOutilsMemoire = new Set(definitionsOutilsMemoire.map((t) => t.name));
export async function executerOutilMemoire(nom, e) {
  switch (nom) {
    case 'memoire_noter': return `Noté (${await noter(e)} souvenirs).`;
    case 'memoire_chercher': { const l = await chercher(e.recherche); return l.length ? l.map((m) => `[${m.categorie}${m.cle ? ' · ' + m.cle : ''}] ${m.texte}`).join('\n') : 'Rien en mémoire sur ce sujet.'; }
    case 'memoire_oublier': return `${await oublier(e.quoi)} souvenir(s) effacé(s).`;
    default: throw new Error(`Outil inconnu : ${nom}`);
  }
}
