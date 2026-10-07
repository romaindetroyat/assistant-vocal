// Analyse de la configuration MCP → paramètres `mcp_servers` et `mcp_toolset` de l'API Claude.
import { config } from './config.js';

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
    serveurs.push({ name: s.name, url: s.url, description: s.description || '', authorization_token: jeton || undefined, allowed_tools: Array.isArray(s.allowed_tools) ? s.allowed_tools : undefined });
  }
  return serveurs;
}

// Configuration fournie en variable d'environnement (Cloudflare) : MCP_CONFIG_JSON.
export function serveursDepuisEnv() {
  if (!config.mcpConfigJson) return null;
  return analyserConfigMcp(config.mcpConfigJson);
}

// Paramètres à passer à client.beta.messages.stream(...)
export function parametresMcp(serveurs) {
  const mcp_servers = serveurs.map((s) => ({ type: 'url', url: s.url, name: s.name, ...(s.authorization_token ? { authorization_token: s.authorization_token } : {}) }));
  const tools = serveurs.map((s) => {
    const toolset = { type: 'mcp_toolset', mcp_server_name: s.name };
    if (s.allowed_tools) { toolset.default_config = { enabled: false }; toolset.configs = Object.fromEntries(s.allowed_tools.map((n) => [n, { enabled: true }])); }
    return toolset;
  });
  return { mcp_servers, tools };
}
