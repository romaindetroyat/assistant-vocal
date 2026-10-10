// Analyse de la configuration MCP → paramètres `mcp_servers` et `mcp_toolset` de l'API Claude.
import { config } from './config.js';
import { lireValeur, ecrireValeur } from './store.js';

const NOM_VALIDE = /^[a-zA-Z0-9_-]{1,64}$/;

export function analyserConfigMcp(texte, env = (typeof process !== 'undefined' ? process.env : {})) {
  let brut;
  try { brut = JSON.parse(texte); }
  catch (e) { throw new Error(`Configuration MCP illisible : ${e.message}`); }
  if (!brut || !Array.isArray(brut.servers)) throw new Error('La configuration MCP doit contenir un tableau "servers"');

  const serveurs = [];
  const nomsVus = new Set();
  for (const [i, s] of brut.servers.entries()) {
    if (s.enabled === false) continue;
    if (!s.name || !NOM_VALIDE.test(s.name)) throw new Error(`servers[${i}] : "name" invalide (lettres, chiffres, - et _)`);
    if (nomsVus.has(s.name)) throw new Error(`servers[${i}] : nom "${s.name}" en double`);
    nomsVus.add(s.name);
    if (!s.url || !/^https:\/\//.test(s.url)) throw new Error(`servers[${i}] (${s.name}) : "url" doit commencer par https://`);
    let jeton;
    if (s.authorization_token_env) {
      jeton = env[s.authorization_token_env];
      if (!jeton) console.warn(`[mcp] ${s.name} : variable ${s.authorization_token_env} absente, serveur sans jeton`);
    } else if (s.authorization_token) {
      jeton = s.authorization_token;
    }
    serveurs.push({ name: s.name, url: s.url, description: s.description || '', authorization_token: jeton || undefined, allowed_tools: Array.isArray(s.allowed_tools) ? s.allowed_tools : undefined, auth: s.auth === 'oauth' ? 'oauth' : 'token' });
  }
  return serveurs;
}

// Descriptions par défaut des serveurs connus (utilisées si MCP_DESC_<NOM> est absent).
const DESCRIPTIONS = {
  agenda: "Agenda Hub : agenda unifié (Perso, Altapyx, TakeOff, Famille) — lister, créer, modifier des rendez-vous, trouver des créneaux, répondre aux invitations. Toujours lister les agendas avant de créer.",
  zapier: "Passerelle Zapier vers les applications de l'utilisateur : Gmail (lire, répondre, envoyer des e-mails), Google Agenda (rendez-vous, disponibilités), Google Drive (fichiers), Notion (pages, bases), Airtable (bases, enregistrements), Granola (notes de réunion), Typeform, Zoho Sheet. Pour les e-mails et l'agenda, c'est ici.",
  gmail: 'Boîte mail : rechercher, lire, répondre, envoyer des e-mails.',
  matrix: "Messagerie Element/Matrix de l'équipe : lire et envoyer des messages.",
  notion: 'Notion : rechercher et modifier des pages et bases.',
};

// Serveurs déclarés par variables d'environnement : MCP_URL_<NOM> (+ MCP_TOKEN_<NOM>, MCP_DESC_<NOM>, MCP_TOOLS_<NOM> séparés par des virgules).
export function serveursDepuisVariables(env = (typeof process !== 'undefined' ? process.env : {})) {
  const serveurs = [];
  for (const [cle, url] of Object.entries(env)) {
    const m = cle.match(/^MCP_URL_([A-Z0-9_]+)$/);
    if (!m || !url) continue;
    const nom = m[1].toLowerCase();
    const outils = env[`MCP_TOOLS_${m[1]}`];
    serveurs.push({
      name: nom,
      url,
      description: env[`MCP_DESC_${m[1]}`] || DESCRIPTIONS[nom] || '',
      authorization_token: env[`MCP_TOKEN_${m[1]}`] || undefined,
      allowed_tools: outils ? outils.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      auth: (env[`MCP_AUTH_${m[1]}`] || '').toLowerCase() === 'oauth' ? 'oauth' : 'token',
    });
  }
  return serveurs.sort((a, b) => a.name.localeCompare(b.name));
}

// Configuration fournie par l'environnement (Cloudflare) : MCP_CONFIG_JSON et/ou variables MCP_URL_<NOM>.
export function serveursDepuisEnv(env = (typeof process !== 'undefined' ? process.env : {})) {
  const parJson = config.mcpConfigJson ? analyserConfigMcp(config.mcpConfigJson, env) : [];
  const parVariables = serveursDepuisVariables(env);
  if (!parJson.length && !parVariables.length) return null;
  const noms = new Set(parJson.map((s) => s.name));
  for (const s of parVariables) {
    if (!/^https:\/\//.test(s.url)) throw new Error(`MCP_URL_${s.name.toUpperCase()} doit commencer par https://`);
    if (!noms.has(s.name)) { parJson.push(s); noms.add(s.name); }
  }
  return parJson;
}

// Paramètres à passer à client.beta.messages.stream(...)
// Serveurs dont les outils sont chargés d'emblée (les plus utilisés) ; les autres sont chargés à la demande par la
// recherche d'outils (defer_loading), ce qui évite d'envoyer des dizaines de milliers de tokens à chaque requête.
export const SERVEURS_PRIORITAIRES = /agenda|calendar|calendrier|mail/i;
export function parametresMcp(serveurs, { differer = true } = {}) {
  const mcp_servers = serveurs.map((s) => ({ type: 'url', url: s.url, name: s.name, ...(s.authorization_token ? { authorization_token: s.authorization_token } : {}) }));
  const tools = serveurs.map((s) => {
    const toolset = { type: 'mcp_toolset', mcp_server_name: s.name };
    const differe = differer && !SERVEURS_PRIORITAIRES.test(`${s.name} ${s.description || ''}`);
    if (differe) toolset.default_config = { defer_loading: true };
    if (s.allowed_tools) { toolset.default_config = { ...(toolset.default_config || {}), enabled: false }; toolset.configs = Object.fromEntries(s.allowed_tools.map((n) => [n, { enabled: true }])); }
    return toolset;
  });
  return { mcp_servers, tools };
}

// Résout les serveurs utilisables pour une requête : jetons OAuth injectés, serveurs OAuth non connectés écartés.
export async function resoudreServeurs(serveurs, jetonPour) {
  const prets = []; const nonConnectes = [];
  for (const s of serveurs) {
    if (s.auth !== 'oauth') { prets.push(s); continue; }
    const jeton = await jetonPour(s.name);
    if (jeton) prets.push({ ...s, authorization_token: jeton }); else nonConnectes.push(s);
  }
  return { prets, nonConnectes };
}

// Serveurs ajoutés depuis l'application (stockés côté serveur).
export const listerServeursAjoutes = async () => (await lireValeur('mcp-servers')) || [];
export async function ajouterServeur({ name, url, description = '', authorization_token = '', auth }, existants = []) {
  const nom = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!nom) throw new Error('Nom invalide');
  if (!/^https:\/\/\S+$/.test(String(url || '').trim())) throw new Error("L'adresse doit commencer par https://");
  if (existants.some((s) => s.name === nom)) throw new Error(`Un serveur « ${nom} » existe déjà`);
  const liste = await listerServeursAjoutes();
  if (liste.some((s) => s.name === nom)) throw new Error(`Un serveur « ${nom} » existe déjà`);
  const serveur = { name: nom, url: String(url).trim(), description: String(description || '').trim() || DESCRIPTIONS[nom] || `Serveur MCP « ${nom} »`, authorization_token: String(authorization_token || '').trim() || undefined, auth: auth === 'oauth' ? 'oauth' : 'token', ajouteLe: new Date().toISOString() };
  liste.push(serveur);
  await ecrireValeur('mcp-servers', liste);
  return serveur;
}
export async function retirerServeur(nom) {
  const liste = await listerServeursAjoutes();
  if (!liste.some((s) => s.name === nom)) return false;
  await ecrireValeur('mcp-servers', liste.filter((s) => s.name !== nom));
  return true;
}
