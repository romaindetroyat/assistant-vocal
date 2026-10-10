// Connexion Google (OAuth 2.0) pour Gmail : plusieurs comptes, jetons stockés côté serveur et rafraîchis.
import { lireValeur, ecrireValeur } from './store.js';

const env = () => (typeof process !== 'undefined' && process.env) || {};
export const PORTEES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/userinfo.email', 'openid'];

export async function configGoogle() {
  const stockee = (await lireValeur('google-config')) || {};
  return { clientId: env().GOOGLE_CLIENT_ID || stockee.clientId || '', clientSecret: env().GOOGLE_CLIENT_SECRET || stockee.clientSecret || '', source: env().GOOGLE_CLIENT_ID ? 'env' : stockee.clientId ? 'app' : null };
}
export async function enregistrerConfigGoogle({ clientId, clientSecret }) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(String(clientId || '').trim())) throw new Error("L'identifiant client doit se terminer par .apps.googleusercontent.com");
  if (!String(clientSecret || '').trim()) throw new Error('Secret client manquant');
  await ecrireValeur('google-config', { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}

export const listerComptes = async () => (await lireValeur('google-comptes')) || [];
const sauverComptes = (c) => ecrireValeur('google-comptes', c);

export async function demarrerConnexionGoogle(redirectUri) {
  const { clientId } = await configGoogle();
  if (!clientId) throw new Error('Identifiant client Google non configuré');
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await ecrireValeur(`google-attente:${state}`, { redirectUri, creeLe: Date.now() });
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', PORTEES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent select_account');
  u.searchParams.set('state', state);
  return u.toString();
}

async function appelJeton(params, fetchImpl) {
  const { clientId, clientSecret } = await configGoogle();
  const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) throw new Error(json.error_description || json.error || `Google : HTTP ${r.status}`);
  return json;
}

export async function terminerConnexionGoogle({ code, state }, fetchImpl = fetch) {
  const attente = await lireValeur(`google-attente:${state}`);
  if (!attente || Date.now() - attente.creeLe > 15 * 60_000) throw new Error('Connexion expirée ou inconnue : recommencez');
  const jetons = await appelJeton({ grant_type: 'authorization_code', code, redirect_uri: attente.redirectUri }, fetchImpl);
  const infos = await (await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${jetons.access_token}` } })).json().catch(() => ({}));
  const email = (infos.email || '').toLowerCase();
  if (!email) throw new Error("Impossible d'identifier le compte Google");
  const comptes = (await listerComptes()).filter((c) => c.email !== email);
  const existant = (await listerComptes()).find((c) => c.email === email);
  comptes.push({ email, refresh_token: jetons.refresh_token || existant?.refresh_token || null, access_token: jetons.access_token, expires_at: Date.now() + (jetons.expires_in || 3600) * 1000, ajouteLe: new Date().toISOString() });
  await sauverComptes(comptes);
  return email;
}

export async function retirerCompte(email, fetchImpl = fetch) {
  const comptes = await listerComptes();
  const c = comptes.find((x) => x.email === email);
  if (c?.refresh_token) { try { await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refresh_token)}`, { method: 'POST' }); } catch { /* ignoré */ } }
  await sauverComptes(comptes.filter((x) => x.email !== email));
}

// Jeton d'accès valide pour un compte (rafraîchi si nécessaire).
export async function jetonAcces(email, fetchImpl = fetch) {
  const comptes = await listerComptes();
  const c = comptes.find((x) => x.email === email);
  if (!c) throw new Error(`Compte Google inconnu : ${email}`);
  if (c.access_token && c.expires_at - Date.now() > 60_000) return c.access_token;
  if (!c.refresh_token) throw new Error(`Compte ${email} à reconnecter (pas de jeton de rafraîchissement)`);
  const j = await appelJeton({ grant_type: 'refresh_token', refresh_token: c.refresh_token }, fetchImpl);
  c.access_token = j.access_token; c.expires_at = Date.now() + (j.expires_in || 3600) * 1000;
  await sauverComptes(comptes);
  return c.access_token;
}

// Résout « compte » (adresse complète, début d'adresse ou mot comme « perso ») vers une adresse connue.
export async function resoudreCompte(indice) {
  const comptes = await listerComptes();
  if (!comptes.length) throw new Error('Aucun compte Google connecté : connectez-en un dans « Mes outils »');
  if (!indice) { if (comptes.length === 1) return comptes[0].email; throw new Error(`Précise le compte parmi : ${comptes.map((c) => c.email).join(', ')}`); }
  const q = String(indice).toLowerCase();
  const trouve = comptes.find((c) => c.email === q) || comptes.find((c) => c.email.startsWith(q)) || comptes.find((c) => c.email.includes(q));
  if (!trouve) throw new Error(`Compte « ${indice} » introuvable parmi : ${comptes.map((c) => c.email).join(', ')}`);
  return trouve.email;
}

// Signatures d'e-mail par compte (ajoutées automatiquement aux envois, réponses et brouillons).
export async function lireSignatures() { return (await lireValeur('gmail-signatures')) || {}; }
export async function definirSignature(email, signature) {
  const comptes = await listerComptes();
  if (!comptes.some((c) => c.email === email)) throw new Error(`Compte inconnu : ${email}`);
  const toutes = await lireSignatures();
  const texte = String(signature || '').trim().slice(0, 1500);
  if (texte) toutes[email] = texte; else delete toutes[email];
  await ecrireValeur('gmail-signatures', toutes);
  return texte;
}
export async function signaturePour(email) { return (await lireSignatures())[email] || ''; }
