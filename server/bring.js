// Bring! (listes de courses) : API non officielle, celle de l'intégration Home Assistant. Identifiants et jetons côté serveur.
import { lireValeur, ecrireValeur, supprimerValeur } from './store.js';

const BASE = 'https://api.getbring.com/rest/';
const ENTETES = { 'X-BRING-API-KEY': 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp', 'X-BRING-CLIENT': 'android', 'X-BRING-APPLICATION': 'bring', 'X-BRING-COUNTRY': 'FR' };

export const bringDisponible = async () => Boolean((await lireValeur('bring-config'))?.email);

async function appel(chemin, { method = 'GET', form, json, auth } = {}, fetchImpl) {
  const entetes = { ...ENTETES };
  if (auth) { entetes.Authorization = `Bearer ${auth.access_token}`; entetes['X-BRING-USER-UUID'] = auth.uuid; entetes['X-BRING-PUBLIC-USER-UUID'] = auth.publicUuid; }
  let body;
  if (form) { entetes['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
  if (json) { entetes['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const r = await fetchImpl(BASE + chemin, { method, headers: entetes, body });
  const texte = await r.text();
  let data = null; try { data = texte ? JSON.parse(texte) : null; } catch { data = null; }
  if (!r.ok) throw new Error(data?.message || data?.errorcode || `Bring! : HTTP ${r.status}`);
  return data;
}

// Connexion avec e-mail et mot de passe : mémorise les identifiants et la session.
export async function connecterBring({ email, password }, fetchImpl = fetch) {
  const e = String(email || '').trim().toLowerCase(); const p = String(password || '');
  if (!e || !p) throw new Error('E-mail et mot de passe requis');
  const data = await appel('v2/bringauth', { method: 'POST', form: { email: e, password: p } }, fetchImpl);
  if (!data?.access_token || !data?.uuid) throw new Error('Connexion Bring! refusée');
  await ecrireValeur('bring-config', { email: e, password: p, name: data.name || '', connecteLe: new Date().toISOString() });
  await ecrireValeur('bring-session', { uuid: data.uuid, publicUuid: data.publicUuid, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000, listeParDefaut: data.bringListUUID || null });
  return { email: e, name: data.name || '' };
}

export async function deconnecterBring() { await supprimerValeur('bring-config'); await supprimerValeur('bring-session'); }

export async function etatBring() {
  const c = await lireValeur('bring-config');
  return c ? { connecte: true, email: c.email, name: c.name, depuis: c.connecteLe } : { connecte: false };
}

// Session valide (rafraîchie, ou reconnectée avec les identifiants si besoin).
async function session(fetchImpl) {
  const s = await lireValeur('bring-session');
  if (s?.access_token && s.expires_at - Date.now() > 60_000) return s;
  if (s?.refresh_token) {
    try {
      const d = await appel('v2/bringauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: s.refresh_token } }, fetchImpl);
      const n = { ...s, access_token: d.access_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 };
      await ecrireValeur('bring-session', n); return n;
    } catch { /* on retombe sur une reconnexion complète */ }
  }
  const c = await lireValeur('bring-config');
  if (!c) throw new Error('Bring! non connecté : connectez-le dans « Mes outils »');
  await connecterBring(c, fetchImpl);
  return lireValeur('bring-session');
}

export async function listerListes(fetchImpl = fetch) {
  const s = await session(fetchImpl);
  const d = await appel(`bringusers/${s.uuid}/lists`, { auth: s }, fetchImpl);
  return (d?.lists || []).map((l) => ({ uuid: l.listUuid, nom: l.name }));
}

export async function resoudreListe(indice, fetchImpl = fetch) {
  const listes = await listerListes(fetchImpl);
  if (!listes.length) throw new Error('Aucune liste Bring!');
  if (!indice) { if (listes.length === 1) return listes[0]; const s = await lireValeur('bring-session'); return listes.find((l) => l.uuid === s?.listeParDefaut) || listes[0]; }
  const q = String(indice).toLowerCase();
  const t = listes.find((l) => l.nom.toLowerCase() === q) || listes.find((l) => l.nom.toLowerCase().includes(q));
  if (!t) throw new Error(`Liste « ${indice} » introuvable. Listes : ${listes.map((l) => l.nom).join(', ')}`);
  return t;
}

export async function lireListe(indice, fetchImpl = fetch) {
  const liste = await resoudreListe(indice, fetchImpl);
  const s = await session(fetchImpl);
  const d = await appel(`v2/bringlists/${liste.uuid}`, { auth: s }, fetchImpl);
  const items = d?.items || d || {};
  const f = (a) => (a || []).map((x) => ({ nom: x.itemId || x.name, precision: x.specification || '' }));
  return { liste, aAcheter: f(items.purchase), recents: f(items.recently) };
}

export async function modifierListe(indice, articles, operation, fetchImpl = fetch) {
  const liste = await resoudreListe(indice, fetchImpl);
  const s = await session(fetchImpl);
  const changes = articles.filter((a) => a?.nom?.trim()).map((a) => ({ itemId: a.nom.trim(), spec: (a.precision || '').trim(), uuid: null, operation, accuracy: '0.0', altitude: '0.0', latitude: '0.0', longitude: '0.0' }));
  if (!changes.length) throw new Error('Aucun article');
  await appel(`v2/bringlists/${liste.uuid}/items`, { method: 'PUT', auth: s, json: { changes, sender: '' } }, fetchImpl);
  return { liste, nb: changes.length };
}

// ---- Outils exposés à l'assistant ----
const schemaArticles = { type: 'array', items: { type: 'object', properties: { nom: { type: 'string', description: "Nom de l'article (ex. Lait)" }, precision: { type: 'string', description: 'Quantité ou précision (ex. 2 L, bio) ; chaîne vide sinon' } }, required: ['nom', 'precision'], additionalProperties: false } };
export const definitionsOutilsBring = [
  { name: 'courses_listes', description: 'Liste les listes de courses Bring! disponibles.', strict: true, input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { name: 'courses_lire', description: "Lit une liste de courses Bring! : articles à acheter et articles récemment achetés.", strict: true, input_schema: { type: 'object', properties: { liste: { type: 'string', description: 'Nom de la liste (vide = liste par défaut)' } }, required: ['liste'], additionalProperties: false } },
  { name: 'courses_ajouter', description: 'Ajoute des articles à une liste de courses Bring!.', strict: true, input_schema: { type: 'object', properties: { liste: { type: 'string', description: 'Nom de la liste (vide = liste par défaut)' }, articles: schemaArticles }, required: ['liste', 'articles'], additionalProperties: false } },
  { name: 'courses_cocher', description: "Marque des articles comme achetés (ils passent dans « récemment »).", strict: true, input_schema: { type: 'object', properties: { liste: { type: 'string' }, articles: schemaArticles }, required: ['liste', 'articles'], additionalProperties: false } },
  { name: 'courses_retirer', description: 'Retire définitivement des articles de la liste.', strict: true, input_schema: { type: 'object', properties: { liste: { type: 'string' }, articles: schemaArticles }, required: ['liste', 'articles'], additionalProperties: false } },
];
export const nomsOutilsBring = new Set(definitionsOutilsBring.map((t) => t.name));

const fmt = (a) => a.map((x) => (x.precision ? `${x.nom} (${x.precision})` : x.nom)).join(', ');
export async function executerOutilBring(nom, e, fetchImpl = fetch) {
  switch (nom) {
    case 'courses_listes': { const l = await listerListes(fetchImpl); return l.length ? `Listes : ${l.map((x) => x.nom).join(', ')}` : 'Aucune liste.'; }
    case 'courses_lire': { const r = await lireListe(e.liste, fetchImpl); return `Liste « ${r.liste.nom} » — à acheter (${r.aAcheter.length}) : ${fmt(r.aAcheter) || 'rien'}.${r.recents.length ? ` Récemment achetés : ${fmt(r.recents.slice(0, 15))}.` : ''}`; }
    case 'courses_ajouter': { const r = await modifierListe(e.liste, e.articles, 'TO_PURCHASE', fetchImpl); return `${r.nb} article(s) ajouté(s) à « ${r.liste.nom} » : ${fmt(e.articles)}.`; }
    case 'courses_cocher': { const r = await modifierListe(e.liste, e.articles, 'TO_RECENTLY', fetchImpl); return `${r.nb} article(s) coché(s) dans « ${r.liste.nom} ».`; }
    case 'courses_retirer': { const r = await modifierListe(e.liste, e.articles, 'REMOVE', fetchImpl); return `${r.nb} article(s) retiré(s) de « ${r.liste.nom} ».`; }
    default: throw new Error(`Outil Bring! inconnu : ${nom}`);
  }
}
