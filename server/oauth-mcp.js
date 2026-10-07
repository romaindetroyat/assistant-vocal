// Connexion OAuth 2.1 (découverte, inscription dynamique, PKCE, rafraîchissement) à un serveur MCP distant.
import { lireValeur, ecrireValeur, supprimerValeur } from './store.js';

const REDIRECT_SECOURS = 'http://localhost:3000/oauth/callback';
const b64url = (octets) => btoa(String.fromCharCode(...octets)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Découverte : ressource protégée → serveur d'autorisation → métadonnées.
export async function decouvrir(urlMcp, fetchImpl = fetch) {
  const u = new URL(urlMcp);
  const candidats = [`${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/$/, '')}`, `${u.origin}/.well-known/oauth-protected-resource`];
  let ressource = null;
  for (const c of candidats) { ressource = await getJson(c, fetchImpl); if (ressource?.authorization_servers?.length) break; }
  const serveurAuth = ressource?.authorization_servers?.[0] || u.origin;
  const as = new URL(serveurAuth);
  const cheminsAs = [`${as.origin}/.well-known/oauth-authorization-server${as.pathname.replace(/\/$/, '')}`, `${as.origin}/.well-known/oauth-authorization-server`, `${as.origin}/.well-known/openid-configuration`];
  let meta = null;
  for (const c of cheminsAs) { meta = await getJson(c, fetchImpl); if (meta?.authorization_endpoint && meta?.token_endpoint) break; meta = null; }
  if (!meta) throw new Error(`Métadonnées OAuth introuvables pour ${urlMcp}`);
  return { meta, scopes: ressource?.scopes_supported || meta.scopes_supported || [], resource: ressource?.resource || urlMcp };
}

async function inscrire(meta, redirectUri, nomClient, fetchImpl) {
  if (!meta.registration_endpoint) throw new Error("Le serveur n'accepte pas l'inscription dynamique de clients");
  const r = await fetchImpl(meta.registration_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: nomClient, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.client_id) { const e = new Error(json.error_description || json.error || `Inscription refusée (HTTP ${r.status})`); e.code = json.error; throw e; }
  return { client_id: json.client_id, client_secret: json.client_secret || null, redirect_uri: redirectUri };
}

/**
 * Prépare l'autorisation : retourne l'URL à ouvrir et si le retour se fera par collage manuel.
 */
export async function demarrerConnexion({ nom, urlMcp, redirectUri, nomClient = 'Assistant vocal' }, fetchImpl = fetch) {
  const { meta, scopes, resource } = await decouvrir(urlMcp, fetchImpl);
  const cle = `mcp-oauth:${nom}`;
  const existant = (await lireValeur(cle)) || {};
  let client = existant.client && existant.client.redirect_uri === redirectUri ? existant.client : null;
  let manuel = false;
  if (!client) {
    try { client = await inscrire(meta, redirectUri, nomClient, fetchImpl); }
    catch (e) {
      if (e.code !== 'invalid_redirect_uri') throw e;
      // Adresse de retour refusée : repli sur localhost, l'utilisateur collera l'adresse finale.
      if (existant.client?.redirect_uri === REDIRECT_SECOURS) client = existant.client;
      else client = await inscrire(meta, REDIRECT_SECOURS, nomClient, fetchImpl);
      manuel = true;
    }
  } else if (redirectUri === REDIRECT_SECOURS) manuel = true;
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await ecrireValeur(cle, { ...existant, client, meta: { token_endpoint: meta.token_endpoint, revocation_endpoint: meta.revocation_endpoint || null }, resource, en_attente: { state, verifier, creeLe: Date.now() } });
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.client_id);
  url.searchParams.set('redirect_uri', client.redirect_uri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (scopes.length) url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('resource', resource);
  return { url: url.toString(), manuel };
}

async function echangerJeton(enreg, params, fetchImpl) {
  const corps = new URLSearchParams({ client_id: enreg.client.client_id, resource: enreg.resource, ...params });
  if (enreg.client.client_secret) corps.set('client_secret', enreg.client.client_secret);
  const r = await fetchImpl(enreg.meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: corps });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) throw new Error(json.error_description || json.error || `Échec d'obtention du jeton (HTTP ${r.status})`);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || enreg.jetons?.refresh_token || null,
    expires_at: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    obtenuLe: new Date().toISOString(),
  };
}

// Termine l'autorisation à partir de l'adresse de retour (ou du code + state).
export async function terminerConnexion({ nom, code, state }, fetchImpl = fetch) {
  const cle = `mcp-oauth:${nom}`;
  const enreg = await lireValeur(cle);
  if (!enreg?.en_attente) throw new Error('Aucune connexion en attente pour ce serveur');
  if (enreg.en_attente.state !== state) throw new Error('Paramètre state inattendu : recommencez la connexion');
  if (Date.now() - enreg.en_attente.creeLe > 15 * 60_000) throw new Error('Connexion expirée : recommencez');
  const jetons = await echangerJeton(enreg, { grant_type: 'authorization_code', code, redirect_uri: enreg.client.redirect_uri, code_verifier: enreg.en_attente.verifier }, fetchImpl);
  const { en_attente: _ignore, ...reste } = enreg;
  await ecrireValeur(cle, { ...reste, jetons });
  return jetons;
}

export function extraireCodeEtState(texte) {
  try {
    const u = new URL(texte.trim());
    const code = u.searchParams.get('code'); const state = u.searchParams.get('state');
    if (code && state) return { code, state };
  } catch { /* pas une URL */ }
  return null;
}

// Jeton d'accès valide (rafraîchi si nécessaire), ou null si non connecté.
export async function jetonPour(nom, fetchImpl = fetch) {
  const cle = `mcp-oauth:${nom}`;
  const enreg = await lireValeur(cle);
  if (!enreg?.jetons?.access_token) return null;
  const { jetons } = enreg;
  if (!jetons.expires_at || jetons.expires_at - Date.now() > 60_000) return jetons.access_token;
  if (!jetons.refresh_token) return null;
  try {
    const nouveaux = await echangerJeton(enreg, { grant_type: 'refresh_token', refresh_token: jetons.refresh_token }, fetchImpl);
    await ecrireValeur(cle, { ...enreg, jetons: nouveaux });
    return nouveaux.access_token;
  } catch (e) {
    console.warn(`[oauth] rafraîchissement ${nom} :`, e.message);
    return null;
  }
}

export async function etatConnexion(nom) {
  const enreg = await lireValeur(`mcp-oauth:${nom}`);
  return { connecte: Boolean(enreg?.jetons?.access_token), depuis: enreg?.jetons?.obtenuLe || null };
}

export async function deconnecter(nom, fetchImpl = fetch) {
  const cle = `mcp-oauth:${nom}`;
  const enreg = await lireValeur(cle);
  if (enreg?.jetons?.access_token && enreg.meta?.revocation_endpoint) {
    try { await fetchImpl(enreg.meta.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: enreg.jetons.access_token, client_id: enreg.client.client_id }) }); } catch { /* ignoré */ }
  }
  await supprimerValeur(cle);
}
