// Serveur d'autorisation OAuth 2.1 minimal pour exposer l'assistant en MCP (claude.ai, Claude Code…) :
// inscription dynamique des clients, code d'autorisation avec PKCE obligatoire, jetons opaques hachés, rotation du refresh.
import { lireValeur, ecrireValeur, supprimerValeur } from './store.js';

const DUREE_CODE_MS = 5 * 60_000;
const DUREE_ACCES_S = 24 * 3600;
const DUREE_RAFRAICHISSEMENT_S = 90 * 24 * 3600;
export const PORTEE = 'assistant';

const hex = (octets) => [...octets].map((b) => b.toString(16).padStart(2, '0')).join('');
const aleatoire = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256hex = async (s) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const sha256b64url = async (s) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function metadonnees(origine) {
  return {
    issuer: origine,
    authorization_endpoint: `${origine}/oauth/authorize`,
    token_endpoint: `${origine}/oauth/token`,
    registration_endpoint: `${origine}/oauth/register`,
    revocation_endpoint: `${origine}/oauth/revoke`,
    scopes_supported: [PORTEE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  };
}
export const metadonneesRessource = (origine) => ({ resource: `${origine}/mcp`, authorization_servers: [origine], scopes_supported: [PORTEE], bearer_methods_supported: ['header'], resource_name: 'Assistant vocal' });

const redirectionValide = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)); } catch { return false; } };

export async function inscrireClient(corps) {
  const uris = Array.isArray(corps.redirect_uris) ? corps.redirect_uris.filter(redirectionValide) : [];
  if (!uris.length) { const e = new Error('redirect_uris invalides (https ou localhost requis)'); e.code = 'invalid_redirect_uri'; throw e; }
  const client = { client_id: `av_${aleatoire(16)}`, client_secret: corps.token_endpoint_auth_method === 'none' ? null : aleatoire(24), client_name: String(corps.client_name || 'Client MCP').slice(0, 100), redirect_uris: uris, creeLe: new Date().toISOString() };
  await ecrireValeur(`oauth-client:${client.client_id}`, client);
  const sortie = { client_id: client.client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: client.client_name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: client.client_secret ? 'client_secret_post' : 'none' };
  if (client.client_secret) sortie.client_secret = client.client_secret;
  return sortie;
}
export const lireClient = (id) => (/^av_[0-9a-f]{32}$/.test(String(id)) ? lireValeur(`oauth-client:${id}`) : Promise.resolve(null));

// Valide une demande d'autorisation ; renvoie le client ou une erreur explicite.
export async function validerAutorisation(q) {
  const client = await lireClient(q.client_id);
  if (!client) throw new Error('client_id inconnu : le client doit d\'abord s\'inscrire');
  if (!client.redirect_uris.includes(q.redirect_uri)) throw new Error('redirect_uri non déclarée pour ce client');
  if (q.response_type !== 'code') throw new Error('response_type doit être "code"');
  if (!q.code_challenge || q.code_challenge_method !== 'S256') throw new Error('PKCE S256 obligatoire');
  return client;
}

export async function emettreCode({ client_id, redirect_uri, code_challenge, scope }) {
  const code = aleatoire(24);
  await ecrireValeur(`oauth-code:${await sha256hex(code)}`, { client_id, redirect_uri, code_challenge, scope: scope || PORTEE, expire: Date.now() + DUREE_CODE_MS });
  return code;
}

async function authentifierClient(p, enTeteAuth) {
  let id = p.get('client_id'); let secret = p.get('client_secret');
  if (enTeteAuth?.startsWith('Basic ')) { try { const [i, s] = atob(enTeteAuth.slice(6)).split(':'); id = decodeURIComponent(i); secret = decodeURIComponent(s || ''); } catch { /* ignoré */ } }
  const client = await lireClient(id);
  if (!client) throw Object.assign(new Error('client inconnu'), { code: 'invalid_client' });
  if (client.client_secret && client.client_secret !== secret) throw Object.assign(new Error('secret client incorrect'), { code: 'invalid_client' });
  return client;
}

async function emettreJetons(client_id, scope) {
  const access = `ava_${aleatoire(32)}`; const refresh = `avr_${aleatoire(32)}`;
  const maintenant = Date.now();
  await ecrireValeur(`oauth-acces:${await sha256hex(access)}`, { client_id, scope, expire: maintenant + DUREE_ACCES_S * 1000 });
  await ecrireValeur(`oauth-refresh:${await sha256hex(refresh)}`, { client_id, scope, expire: maintenant + DUREE_RAFRAICHISSEMENT_S * 1000 });
  return { access_token: access, token_type: 'Bearer', expires_in: DUREE_ACCES_S, refresh_token: refresh, scope };
}

export async function echangerJeton(params, enTeteAuth) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const client = await authentifierClient(p, enTeteAuth);
  const grant = p.get('grant_type');
  if (grant === 'authorization_code') {
    const code = p.get('code') || ''; const cle = `oauth-code:${await sha256hex(code)}`;
    const enreg = await lireValeur(cle);
    if (enreg) await supprimerValeur(cle); // usage unique
    if (!enreg || enreg.expire < Date.now()) throw Object.assign(new Error('code invalide ou expiré'), { code: 'invalid_grant' });
    if (enreg.client_id !== client.client_id || enreg.redirect_uri !== p.get('redirect_uri')) throw Object.assign(new Error('code émis pour un autre client ou une autre redirection'), { code: 'invalid_grant' });
    if ((await sha256b64url(p.get('code_verifier') || '')) !== enreg.code_challenge) throw Object.assign(new Error('code_verifier incorrect'), { code: 'invalid_grant' });
    return emettreJetons(client.client_id, enreg.scope);
  }
  if (grant === 'refresh_token') {
    const cle = `oauth-refresh:${await sha256hex(p.get('refresh_token') || '')}`;
    const enreg = await lireValeur(cle);
    if (!enreg || enreg.expire < Date.now() || enreg.client_id !== client.client_id) throw Object.assign(new Error('refresh_token invalide'), { code: 'invalid_grant' });
    await supprimerValeur(cle); // rotation
    return emettreJetons(client.client_id, enreg.scope);
  }
  throw Object.assign(new Error('grant_type non pris en charge'), { code: 'unsupported_grant_type' });
}

export async function revoquer(jeton) {
  if (!jeton) return;
  const h = await sha256hex(jeton);
  await supprimerValeur(`oauth-acces:${h}`); await supprimerValeur(`oauth-refresh:${h}`);
}

// Vérifie un en-tête Authorization: Bearer ; renvoie l'enregistrement du jeton ou null.
export async function verifierAcces(enTeteAuth) {
  if (!enTeteAuth?.startsWith('Bearer ')) return null;
  const jeton = enTeteAuth.slice(7).trim();
  if (!/^ava_[0-9a-f]{64}$/.test(jeton)) return null;
  const enreg = await lireValeur(`oauth-acces:${await sha256hex(jeton)}`);
  if (!enreg || enreg.expire < Date.now()) return null;
  return enreg;
}

export async function listerClients() {
  // Les backends n'ont pas de listage par préfixe : on tient un index léger.
  return (await lireValeur('oauth-clients-index')) || [];
}
export async function indexerClient(client) {
  const index = (await listerClients()).filter((c) => c.client_id !== client.client_id);
  index.push({ client_id: client.client_id, client_name: client.client_name, creeLe: client.creeLe || new Date().toISOString() });
  await ecrireValeur('oauth-clients-index', index);
}
export async function supprimerClient(id) {
  await supprimerValeur(`oauth-client:${id}`);
  await ecrireValeur('oauth-clients-index', (await listerClients()).filter((c) => c.client_id !== id));
}
