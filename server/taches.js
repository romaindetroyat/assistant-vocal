// Liste de tâches intelligente : échéances, priorités, projets ; rappels liés ; point du matin.
import { lireValeur, ecrireValeur, ajouterRappel, listerRappels, sauverRappels } from './store.js';

const id = () => Math.random().toString(36).slice(2, 8);
export const lireTaches = async () => (await lireValeur('taches')) || [];
async function sauver(l) { await ecrireValeur('taches', l); }
const PRIORITES = ['haute', 'normale', 'basse'];

function dateParis(d = new Date()) { return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }

export async function ajouterTache({ titre, echeance, heure, priorite, projet, notes }) {
  const t = String(titre || '').trim().slice(0, 200);
  if (!t) throw new Error('Titre obligatoire');
  const taches = await lireTaches();
  const tache = { id: id(), titre: t, echeance: /^\d{4}-\d{2}-\d{2}$/.test(echeance || '') ? echeance : null, heure: /^\d{2}:\d{2}$/.test(heure || '') ? heure : null, priorite: PRIORITES.includes(priorite) ? priorite : 'normale', projet: String(projet || '').trim().slice(0, 60) || null, notes: String(notes || '').trim().slice(0, 1000) || null, statut: 'a_faire', creeLe: new Date().toISOString() };
  taches.push(tache);
  await sauver(taches);
  // Une tâche avec date et heure déclenche un rappel push 15 min avant.
  if (tache.echeance && tache.heure) {
    const quand = new Date(`${tache.echeance}T${tache.heure}:00${decalageParis(tache.echeance)}`);
    quand.setMinutes(quand.getMinutes() - 15);
    if (quand.getTime() > Date.now()) { const r = await ajouterRappel({ quand: quand.toISOString(), titre: 'Dans 15 min', corps: tache.titre }); tache.rappelId = r.id; await sauver(taches); }
  }
  return tache;
}
// Décalage Europe/Paris pour une date donnée (+02:00 en été, +01:00 en hiver).
function decalageParis(dateIso) {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const h = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(d));
  return h === 14 ? '+02:00' : '+01:00';
}

export async function modifierTache(idOuTitre, modifs) {
  const taches = await lireTaches();
  const t = trouver(taches, idOuTitre);
  if (modifs.titre) t.titre = String(modifs.titre).trim().slice(0, 200);
  if (modifs.echeance !== undefined) t.echeance = /^\d{4}-\d{2}-\d{2}$/.test(modifs.echeance || '') ? modifs.echeance : null;
  if (modifs.heure !== undefined) t.heure = /^\d{2}:\d{2}$/.test(modifs.heure || '') ? modifs.heure : null;
  if (modifs.priorite && PRIORITES.includes(modifs.priorite)) t.priorite = modifs.priorite;
  if (modifs.projet !== undefined) t.projet = String(modifs.projet || '').trim().slice(0, 60) || null;
  if (modifs.notes !== undefined) t.notes = String(modifs.notes || '').trim().slice(0, 1000) || null;
  if (modifs.statut && ['a_faire', 'fait'].includes(modifs.statut)) { t.statut = modifs.statut; t.faitLe = modifs.statut === 'fait' ? new Date().toISOString() : undefined; }
  t.majLe = new Date().toISOString();
  await sauver(taches);
  if (t.statut === 'fait' && t.rappelId) { await sauverRappels((await listerRappels()).filter((r) => r.id !== t.rappelId)); t.rappelId = undefined; await sauver(taches); }
  return t;
}
export async function supprimerTache(idOuTitre) {
  const taches = await lireTaches();
  const t = trouver(taches, idOuTitre);
  await sauver(taches.filter((x) => x.id !== t.id));
  return t;
}
function trouver(taches, q) {
  const s = String(q || '').toLowerCase().trim();
  const t = taches.find((x) => x.id === s) || taches.filter((x) => x.statut === 'a_faire').find((x) => x.titre.toLowerCase() === s) || taches.filter((x) => x.statut === 'a_faire').find((x) => x.titre.toLowerCase().includes(s));
  if (!t) throw new Error(`Tâche « ${q} » introuvable`);
  return t;
}

const poids = { haute: 0, normale: 1, basse: 2 };
export function trier(taches) {
  return [...taches].sort((a, b) => (a.echeance || '9999') < (b.echeance || '9999') ? -1 : (a.echeance || '9999') > (b.echeance || '9999') ? 1 : poids[a.priorite] - poids[b.priorite] || (a.heure || '99') < (b.heure || '99') ? -1 : 1);
}

export async function listerTaches({ filtre = 'a_faire', projet = '' } = {}) {
  const aujourdhui = dateParis();
  let l = await lireTaches();
  if (projet) l = l.filter((t) => (t.projet || '').toLowerCase().includes(projet.toLowerCase()));
  switch (filtre) {
    case 'aujourdhui': l = l.filter((t) => t.statut === 'a_faire' && t.echeance && t.echeance <= aujourdhui); break;
    case 'retard': l = l.filter((t) => t.statut === 'a_faire' && t.echeance && t.echeance < aujourdhui); break;
    case 'semaine': { const d = new Date(); d.setDate(d.getDate() + 7); const lim = dateParis(d); l = l.filter((t) => t.statut === 'a_faire' && t.echeance && t.echeance <= lim); break; }
    case 'faites': l = l.filter((t) => t.statut === 'fait'); break;
    case 'toutes': break;
    default: l = l.filter((t) => t.statut === 'a_faire');
  }
  return trier(l);
}

export function formater(t, aujourdhui = dateParis()) {
  const retard = t.statut === 'a_faire' && t.echeance && t.echeance < aujourdhui;
  const quand = t.echeance ? (t.echeance === aujourdhui ? "aujourd'hui" : t.echeance) + (t.heure ? ` ${t.heure}` : '') : 'sans date';
  return `${t.statut === 'fait' ? '✓' : retard ? '⚠' : '•'} ${t.titre} — ${quand}${t.priorite !== 'normale' ? `, priorité ${t.priorite}` : ''}${t.projet ? `, projet ${t.projet}` : ''} (id ${t.id})`;
}

// Point du matin : résumé des tâches du jour et en retard, à envoyer en push une fois par jour.
export async function resumeDuJour() {
  const auj = dateParis();
  const l = await listerTaches({ filtre: 'aujourdhui' });
  if (!l.length) return null;
  const retard = l.filter((t) => t.echeance < auj).length;
  const top = l.slice(0, 3).map((t) => t.titre).join(' · ');
  return { titre: `${l.length} tâche(s) aujourd'hui${retard ? `, ${retard} en retard` : ''}`, corps: top };
}

export const definitionsOutilsTaches = [
  { name: 'tache_ajouter', description: "Ajoute une tâche. Déduis l'échéance (date absolue à partir de la date courante), l'heure si donnée, la priorité (haute si urgent/important) et le projet/contexte (TakeOff, Altapyx, perso, maison…) d'après ce que dit l'utilisateur. Une tâche avec date ET heure crée un rappel push 15 min avant.", strict: true,
    input_schema: { type: 'object', properties: { titre: { type: 'string', description: 'Verbe à l\'infinitif + objet, court' }, echeance: { type: 'string', description: 'AAAA-MM-JJ ou chaîne vide' }, heure: { type: 'string', description: 'HH:MM ou chaîne vide' }, priorite: { type: 'string', enum: PRIORITES }, projet: { type: 'string', description: 'Projet ou contexte, chaîne vide sinon' }, notes: { type: 'string', description: 'Détails utiles, chaîne vide sinon' } }, required: ['titre', 'echeance', 'heure', 'priorite', 'projet', 'notes'], additionalProperties: false } },
  { name: 'tache_lister', description: 'Liste les tâches. Filtres : a_faire (défaut), aujourdhui (dues aujourd\'hui ou en retard), retard, semaine, faites, toutes ; projet optionnel.', strict: true,
    input_schema: { type: 'object', properties: { filtre: { type: 'string', enum: ['a_faire', 'aujourdhui', 'retard', 'semaine', 'faites', 'toutes'] }, projet: { type: 'string', description: 'Filtre par projet, chaîne vide sinon' } }, required: ['filtre', 'projet'], additionalProperties: false } },
  { name: 'tache_terminer', description: 'Marque une tâche comme faite (par id ou par un bout de son titre).', strict: true, input_schema: { type: 'object', properties: { tache: { type: 'string' } }, required: ['tache'], additionalProperties: false } },
  { name: 'tache_modifier', description: "Modifie une tâche : titre, échéance, heure, priorité, projet, notes, ou la rouvre (statut a_faire). Champs non modifiés : chaîne vide.", strict: true,
    input_schema: { type: 'object', properties: { tache: { type: 'string' }, titre: { type: 'string' }, echeance: { type: 'string' }, heure: { type: 'string' }, priorite: { type: 'string', description: 'haute | normale | basse | vide' }, projet: { type: 'string' }, notes: { type: 'string' }, statut: { type: 'string', description: 'a_faire | fait | vide' } }, required: ['tache', 'titre', 'echeance', 'heure', 'priorite', 'projet', 'notes', 'statut'], additionalProperties: false } },
  { name: 'tache_supprimer', description: 'Supprime définitivement une tâche.', strict: true, input_schema: { type: 'object', properties: { tache: { type: 'string' } }, required: ['tache'], additionalProperties: false } },
];
export const nomsOutilsTaches = new Set(definitionsOutilsTaches.map((t) => t.name));
export async function executerOutilTaches(nom, e) {
  switch (nom) {
    case 'tache_ajouter': { const t = await ajouterTache(e); return `Tâche ajoutée : ${formater(t)}${t.rappelId ? ' — rappel programmé 15 min avant.' : ''}`; }
    case 'tache_lister': { const l = await listerTaches({ filtre: e.filtre, projet: e.projet }); return l.length ? `${l.length} tâche(s) :\n${l.map((t) => formater(t)).join('\n')}` : 'Aucune tâche pour ce filtre.'; }
    case 'tache_terminer': { const t = await modifierTache(e.tache, { statut: 'fait' }); return `Fait : ${t.titre}.`; }
    case 'tache_modifier': { const m = {}; for (const k of ['titre', 'echeance', 'heure', 'priorite', 'projet', 'notes', 'statut']) if (e[k]) m[k] = e[k]; const t = await modifierTache(e.tache, m); return `Mise à jour : ${formater(t)}`; }
    case 'tache_supprimer': { const t = await supprimerTache(e.tache); return `Supprimée : ${t.titre}.`; }
    default: throw new Error(`Outil inconnu : ${nom}`);
  }
}
