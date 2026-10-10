// Consignes personnelles : instructions durables de l'utilisateur, injectées dans le prompt système.
import { lireValeur, ecrireValeur } from './store.js';

export const lireConsignes = async () => (await lireValeur('consignes')) || [];
export async function ajouterConsigne(texte) {
  const t = String(texte || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!t) throw new Error('Consigne vide');
  const liste = await lireConsignes();
  if (liste.some((c) => c.texte.toLowerCase() === t.toLowerCase())) return liste;
  liste.push({ id: Math.random().toString(36).slice(2, 8), texte: t, creeLe: new Date().toISOString() });
  if (liste.length > 60) liste.shift();
  await ecrireValeur('consignes', liste);
  return liste;
}
export async function retirerConsigne(idOuTexte) {
  const liste = await lireConsignes();
  const q = String(idOuTexte || '').toLowerCase();
  const reste = liste.filter((c) => c.id !== q && !c.texte.toLowerCase().includes(q));
  if (reste.length === liste.length) throw new Error('Aucune consigne ne correspond');
  await ecrireValeur('consignes', reste);
  return reste;
}
export async function remplacerConsignes(textes) {
  const liste = textes.map((t) => String(t).trim()).filter(Boolean).slice(0, 60).map((texte) => ({ id: Math.random().toString(36).slice(2, 8), texte, creeLe: new Date().toISOString() }));
  await ecrireValeur('consignes', liste);
  return liste;
}

export const definitionsOutilsConsignes = [
  { name: 'retenir', description: "Mémorise une consigne durable de l'utilisateur (préférence, habitude, correspondance entre un mot et un outil, personne, projet). À appeler quand il dit « retiens », « souviens-toi », « désormais », « à partir de maintenant ».", strict: true,
    input_schema: { type: 'object', properties: { consigne: { type: 'string', description: 'La consigne, reformulée en une phrase claire à la troisième personne (ex. « Quand il parle de liste de courses, il s\'agit de Bring! »)' } }, required: ['consigne'], additionalProperties: false } },
  { name: 'oublier', description: 'Supprime une consigne mémorisée (par un mot qu\'elle contient).', strict: true,
    input_schema: { type: 'object', properties: { quoi: { type: 'string', description: 'Mot ou extrait de la consigne à retirer' } }, required: ['quoi'], additionalProperties: false } },
];
export const nomsOutilsConsignes = new Set(definitionsOutilsConsignes.map((t) => t.name));
export async function executerOutilConsignes(nom, e) {
  if (nom === 'retenir') { const l = await ajouterConsigne(e.consigne); return `Consigne retenue. (${l.length} consigne(s) au total)`; }
  if (nom === 'oublier') { const l = await retirerConsigne(e.quoi); return `Consigne retirée. (${l.length} restante(s))`; }
  throw new Error(`Outil inconnu : ${nom}`);
}
