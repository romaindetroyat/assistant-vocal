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

// Mot-clé d'un compte : premier libellé du domaine (romain@meridia.tl → « meridia », rdetroyat@altapyx.com → « altapyx »).
export const aliasCompte = (email) => String(email || '').toLowerCase().split('@')[1]?.split('.')[0] || '';

// Messages d'erreur Google (OAuth) en français, avec la marche à suivre pour un domaine Google Workspace.
const AIDE_WORKSPACE = "Si c'est un compte Google Workspace (ex. meridia.tl), l'administrateur doit autoriser l'application : admin.google.com → Sécurité → Accès et contrôle des données → Contrôle des API → Gérer l'accès des applications tierces → Configurer une nouvelle application → ID client OAuth de l'assistant → « Approuvée » (ou « Fiable »). Vérifiez aussi que l'API Gmail est autorisée pour le domaine, puis réessayez.";
export function messageErreurGoogle(code, description = '') {
  const c = String(code || '').trim();
  const d = String(description || '').trim();
  switch (c) {
    case 'admin_policy_enforced': return `Le domaine Google Workspace bloque l'accès de l'assistant à Gmail (règle de l'administrateur). ${AIDE_WORKSPACE}`;
    case 'org_internal': return "L'application OAuth Google de l'assistant est réservée à une autre organisation (type « Interne ») : passez-la en « Externe » dans la console Google Cloud (Écran de consentement OAuth), ou utilisez un compte de cette organisation.";
    case 'access_denied': return `Autorisation refusée ou bloquée par Google. Si vous avez bien accepté, l'accès est sans doute bloqué : application en mode « Test » sans cette adresse dans les utilisateurs test (console Google Cloud → Écran de consentement OAuth → Utilisateurs test), ou domaine Workspace qui n'autorise pas l'application. ${AIDE_WORKSPACE}`;
    case 'unauthorized_client': case 'invalid_client': return "Identifiants OAuth Google refusés (ID client ou secret incorrect) : vérifiez-les dans Réglages → Gmail.";
    case 'invalid_grant': return "Autorisation Google expirée ou révoquée (mot de passe changé, accès retiré par l'administrateur, ou application en mode « Test » : jetons valables 7 jours). Reconnectez le compte avec « Ajouter un compte Gmail ».";
    case 'redirect_uri_mismatch': return "Adresse de redirection non déclarée dans l'ID client Google : ajoutez-la (voir Réglages → Gmail).";
    default: return d || c || 'Erreur Google inconnue';
  }
}
const erreurGoogle = (code, description) => Object.assign(new Error(messageErreurGoogle(code, description)), { code });

export async function demarrerConnexionGoogle(redirectUri, { retour } = {}) {
  const { clientId } = await configGoogle();
  if (!clientId) throw new Error('Identifiant client Google non configuré');
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await ecrireValeur(`google-attente:${state}`, { redirectUri, creeLe: Date.now(), retour: retour === 'app' ? 'app' : 'outils' });
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
  if (!r.ok || !json.access_token) { if (json.error) throw erreurGoogle(json.error, json.error_description); throw new Error(`Google : HTTP ${r.status}`); }
  return json;
}

// Page de retour mémorisée pour une connexion en cours (« app » quand elle part du menu, « outils » sinon).
export async function retourConnexion(state) {
  if (!state) return 'outils';
  return (await lireValeur(`google-attente:${state}`))?.retour === 'app' ? 'app' : 'outils';
}

// Échange le code contre des jetons et enregistre le compte. Un compte déjà connecté est mis à jour à sa place
// (jetons rafraîchis, pas de doublon, ordre des comptes inchangé).
export async function connecterCompteGoogle({ code, state }, fetchImpl = fetch) {
  const attente = await lireValeur(`google-attente:${state}`);
  if (!attente || Date.now() - attente.creeLe > 15 * 60_000) throw new Error('Connexion expirée ou inconnue : recommencez');
  const jetons = await appelJeton({ grant_type: 'authorization_code', code, redirect_uri: attente.redirectUri }, fetchImpl);
  const infos = await (await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${jetons.access_token}` } })).json().catch(() => ({}));
  const email = (infos.email || '').toLowerCase();
  if (!email) throw new Error("Impossible d'identifier le compte Google");
  const comptes = await listerComptes();
  const i = comptes.findIndex((c) => c.email === email);
  const existant = i >= 0 ? comptes[i] : null;
  const maintenant = new Date().toISOString();
  const compte = { email, refresh_token: jetons.refresh_token || existant?.refresh_token || null, access_token: jetons.access_token, expires_at: Date.now() + (jetons.expires_in || 3600) * 1000, ajouteLe: existant?.ajouteLe || maintenant, ...(existant ? { misAJourLe: maintenant } : {}) };
  if (existant) comptes[i] = compte; else comptes.push(compte);
  await sauverComptes(comptes);
  return { email, deja: Boolean(existant), retour: attente.retour === 'app' ? 'app' : 'outils' };
}
export const terminerConnexionGoogle = async (params, fetchImpl = fetch) => (await connecterCompteGoogle(params, fetchImpl)).email;

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
  let j;
  try { j = await appelJeton({ grant_type: 'refresh_token', refresh_token: c.refresh_token }, fetchImpl); }
  catch (e) { if (e.code) throw Object.assign(new Error(`Compte ${email} : ${e.message}`), { code: e.code }); throw e; }
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
  const trouve = comptes.find((c) => c.email === q) || comptes.find((c) => aliasCompte(c.email) === q) || comptes.find((c) => c.email.startsWith(q)) || comptes.find((c) => c.email.includes(q));
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
