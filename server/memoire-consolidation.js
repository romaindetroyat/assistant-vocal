// Consolidation de la mémoire de personnalisation par Claude : fusion des doublons et contradictions,
// suppression de l'obsolète, profil court. Traitement de fond (hebdomadaire) ou à la demande, journalisé.
import { config } from './config.js';
import { lireValeur, ecrireValeur } from './store.js';
import { CATEGORIES, lireMemoire, remplacerMemoire } from './memoire.js';

export const SEUIL_MIN = 8;      // en dessous, rien à consolider
export const MAX_ENTREES = 60;   // taille du profil après consolidation
const JOURNAL_MAX = 20;
const RESUME_MAX = 10;
const SEPT_JOURS = 7 * 24 * 3600 * 1000;
const id = () => Math.random().toString(36).slice(2, 8);

const PROMPT_SYSTEME = `Tu consolides la mémoire de personnalisation d'un assistant personnel : une liste de faits durables sur l'utilisateur.
Tu reçois la liste actuelle (JSON). Chaque entrée porte une catégorie, une clé stable facultative, un texte, la date de dernière mise à jour (majLe) et le nombre de fois où le fait a été confirmé (vu).

Règles :
- Fusionne les doublons et les faits redondants en une seule entrée claire.
- En cas de contradiction, garde la version la plus récente (majLe le plus grand) ; en cas d'égalité, la plus confirmée (vu).
- Supprime les faits éphémères, périmés ou sans valeur durable (événements passés ponctuels, états temporaires).
- Conserve les clés stables existantes (cle) quand l'entrée survit ; n'invente une clé que si elle est évidente (un mot court en minuscules), sinon mets "".
- Catégories autorisées : ${CATEGORIES.join(', ')}.
- Maximum ${MAX_ENTREES} entrées. Phrases courtes, en français, à la troisième personne.

Réponds UNIQUEMENT avec un tableau JSON strict d'objets {"categorie": "...", "cle": "...", "texte": "..."}, sans commentaire ni texte autour.`;

// Extrait un tableau JSON de la réponse, en tolérant un bloc \`\`\`json … \`\`\` ou du texte autour.
export function extraireJson(texte) {
  const t = String(texte || '').trim();
  const bloc = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const brut = bloc ? bloc[1].trim() : t;
  try { return JSON.parse(brut); } catch {}
  const debut = brut.indexOf('['); const fin = brut.lastIndexOf(']');
  if (debut === -1 || fin <= debut) return null;
  try { return JSON.parse(brut.slice(debut, fin + 1)); } catch { return null; }
}

// Valide et normalise la liste proposée ; renvoie null si inexploitable (une liste vide est refusée :
// la consolidation ne doit jamais effacer toute la mémoire).
export function validerProposition(proposition) {
  if (!Array.isArray(proposition) || !proposition.length) return null;
  const sortie = [];
  for (const e of proposition) {
    if (!e || typeof e !== 'object') return null;
    const texte = String(e.texte || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!texte) return null;
    if (!CATEGORIES.includes(e.categorie)) return null;
    const cle = String(e.cle || '').trim().toLowerCase().slice(0, 60) || undefined;
    sortie.push({ categorie: e.categorie, cle, texte });
  }
  return sortie.slice(0, MAX_ENTREES);
}

async function demanderAClaude(client, memoire) {
  const entree = memoire.map((m) => ({ categorie: m.categorie, cle: m.cle || '', texte: m.texte, majLe: m.majLe || m.creeLe || '', vu: m.vu || 1 }));
  const reponse = await client.beta.messages.create({
    model: config.model,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: PROMPT_SYSTEME,
    messages: [{ role: 'user', content: `Mémoire actuelle (${entree.length} entrées) :\n${JSON.stringify(entree)}` }],
  });
  return (reponse.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export const lireJournalMemoire = async () => (await lireValeur('memoire-journal')) || [];
async function journaliser(entree) {
  const journal = await lireJournalMemoire();
  journal.unshift(entree);
  await ecrireValeur('memoire-journal', journal.slice(0, JOURNAL_MAX));
  return entree;
}

const norm = (s) => String(s || '').toLowerCase().trim();

// Consolide la mémoire. Renvoie l'entrée de journal, ou null si rien à faire (< SEUIL_MIN entrées).
export async function consoliderMemoire({ client, maintenant = new Date() } = {}) {
  const avant = await lireMemoire();
  if (avant.length < SEUIL_MIN) return null;
  const date = new Date(maintenant).toISOString();
  let texte;
  try { texte = await demanderAClaude(client, avant); }
  catch (e) { return journaliser({ date, ok: false, avant: avant.length, apres: avant.length, fusionnees: 0, supprimees: 0, resume: [`Échec de l'appel à Claude : ${e.message}`] }); }
  const proposition = validerProposition(extraireJson(texte));
  if (!proposition) return journaliser({ date, ok: false, avant: avant.length, apres: avant.length, fusionnees: 0, supprimees: 0, resume: ['Réponse invalide (JSON attendu) : mémoire inchangée.'] });

  // Reconstruction : on préserve id, creeLe et vu des entrées déjà connues (même clé et catégorie, sinon même texte).
  const restantes = [...avant];
  const prendre = (p) => {
    let i = p.cle ? restantes.findIndex((m) => m.cle === p.cle && m.categorie === p.categorie) : -1;
    if (i === -1) i = restantes.findIndex((m) => norm(m.texte) === norm(p.texte));
    return i === -1 ? null : restantes.splice(i, 1)[0];
  };
  const apres = []; let fusionnees = 0; const resume = [];
  for (const p of proposition) {
    const ancienne = prendre(p);
    if (ancienne) {
      if (norm(ancienne.texte) !== norm(p.texte)) { fusionnees++; resume.push(`Reformulé : « ${ancienne.texte} » → « ${p.texte} »`); }
      apres.push({ id: ancienne.id, categorie: p.categorie, cle: p.cle ?? ancienne.cle, texte: p.texte, creeLe: ancienne.creeLe, majLe: norm(ancienne.texte) === norm(p.texte) ? ancienne.majLe : date, vu: ancienne.vu || 1 });
    } else {
      fusionnees++; resume.push(`Fusionné : « ${p.texte} »`);
      apres.push({ id: id(), categorie: p.categorie, cle: p.cle, texte: p.texte, creeLe: date, majLe: date, vu: 1 });
    }
  }
  for (const m of restantes) resume.push(`Supprimé : « ${m.texte} »`);
  await remplacerMemoire(apres);
  return journaliser({ date, ok: true, avant: avant.length, apres: apres.length, fusionnees, supprimees: restantes.length, resume: resume.slice(0, RESUME_MAX) });
}

function heureParis(d) {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).formatToParts(d);
  return Number(parts.find((p) => p.type === 'hour')?.value);
}

// Garde hebdomadaire : au plus une consolidation tous les 7 jours, à partir de 6 h (Europe/Paris).
// Renvoie true si une consolidation a été lancée.
export async function consolidationHebdo({ client, maintenant = new Date() } = {}) {
  const d = new Date(maintenant);
  if (heureParis(d) < 6) return false;
  const etat = (await lireValeur('memoire-consolidation')) || {};
  if (etat.derniere && d.getTime() - new Date(etat.derniere).getTime() < SEPT_JOURS) return false;
  await ecrireValeur('memoire-consolidation', { derniere: d.toISOString() });
  await consoliderMemoire({ client, maintenant: d });
  return true;
}
