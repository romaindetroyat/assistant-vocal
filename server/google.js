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

// Comptes retirés définitivement (adresse qui ne sert plus) et mots-clés qui y renvoyaient : jamais listés ni utilisables,
// purgés du stockage (jeton révoqué chez Google, signature effacée) à la première lecture.
export const COMPTES_RETIRES = ['romain@takeoff.do'];
export const ALIAS_RETIRES = ['takeoff', 'takeoff.do', 'take off'];
export const estCompteRetire = (indice) => {
  const q = String(indice || '').trim().toLowerCase();
  if (!q) return false;
  return COMPTES_RETIRES.includes(q) || ALIAS_RETIRES.includes(q) || q.includes('takeoff');
};

export class CompteNonConnecte extends Error {}

const sauverComptes = (c) => ecrireValeur('google-comptes', c);

// Retire du stockage les comptes de COMPTES_RETIRES : révocation du jeton (au mieux), signature effacée.
export async function purgerComptesRetires(fetchImpl = fetch) {
  const tous = (await lireValeur('google-comptes')) || [];
  const retires = tous.filter((c) => COMPTES_RETIRES.includes(c.email));
  if (retires.length) {
    for (const c of retires) {
      const jeton = c.refresh_token || c.access_token;
      if (jeton) { try { await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(jeton)}`, { method: 'POST' }); } catch { /* ignoré */ } }
    }
    await sauverComptes(tous.filter((c) => !COMPTES_RETIRES.includes(c.email)));
  }
  const signatures = (await lireValeur('gmail-signatures')) || {};
  if (COMPTES_RETIRES.some((e) => e in signatures)) {
    for (const e of COMPTES_RETIRES) delete signatures[e];
    await ecrireValeur('gmail-signatures', signatures);
  }
  return retires.map((c) => c.email);
}

export async function listerComptes(fetchImpl = fetch) {
  const tous = (await lireValeur('google-comptes')) || [];
  if (tous.some((c) => COMPTES_RETIRES.includes(c.email))) { await purgerComptesRetires(fetchImpl).catch(() => {}); }
  return tous.filter((c) => !COMPTES_RETIRES.includes(c.email));
}

// `retour` : page où revenir après l'autorisation (« app » : le menu de l'application, sinon Mes outils).
export async function demarrerConnexionGoogle(redirectUri, { retour = 'outils' } = {}) {
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
  if (COMPTES_RETIRES.includes(email)) throw new Error(`Le compte ${email} a été retiré de l'assistant et ne peut plus être connecté`);
  // Compte déjà connecté : jeton rafraîchi à la même place (pas de doublon, ordre conservé) ; sinon ajouté à la fin.
  const comptes = await listerComptes();
  const existant = comptes.find((c) => c.email === email);
  const compte = { email, refresh_token: jetons.refresh_token || existant?.refresh_token || null, access_token: jetons.access_token, expires_at: Date.now() + (jetons.expires_in || 3600) * 1000, ajouteLe: existant?.ajouteLe || new Date().toISOString() };
  await sauverComptes(existant ? comptes.map((c) => (c.email === email ? compte : c)) : [...comptes, compte]);
  return email;
}

// Lit la page de retour enregistrée pour une connexion en cours (avant de la terminer).
export async function retourConnexion(state) { return (await lireValeur(`google-attente:${state}`))?.retour || 'outils'; }

// Refus de Google renvoyé à l'adresse de retour (?error=…) : message clair, notamment pour un domaine Google Workspace
// (meridia.tl…) dont l'administrateur doit d'abord autoriser l'application.
export function messageErreurGoogle(erreur, clientId = '') {
  const id = clientId ? ` (ID client ${clientId})` : '';
  if (/admin_policy_enforced|org_internal|disallowed_useragent|unauthorized_client/.test(erreur)) return `Le domaine Google Workspace bloque l'application${id}. Dans la console d'administration (admin.google.com → Sécurité → Accès et contrôle des données → Commandes des API → Gérer l'accès des applications tierces), ajoutez l'application par son ID client et passez-la en « Fiable », puis recommencez.`;
  if (/access_denied/.test(erreur)) return "Autorisation refusée sur l'écran Google. Si vous n'avez pas refusé vous-même : l'écran de consentement OAuth du projet Google Cloud est peut-être en mode « Test » : ajoutez l'adresse à connecter dans « Utilisateurs test », ou autorisez l'application dans la console d'administration Workspace du domaine.";
  return `Connexion Google refusée : ${erreur || 'raison inconnue'}`;
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
  if (estCompteRetire(indice)) throw new CompteNonConnecte(`Compte non connecté : « ${indice} » (romain@takeoff.do) a été retiré de l'assistant.${comptes.length ? ` Comptes disponibles : ${comptes.map((c) => c.email).join(', ')}` : ''}`);
  if (!comptes.length) throw new Error('Aucun compte Google connecté : connectez-en un dans « Mes outils »');
  if (!indice) { if (comptes.length === 1) return comptes[0].email; throw new Error(`Précise le compte parmi : ${comptes.map((c) => c.email).join(', ')}`); }
  const q = String(indice).trim().toLowerCase();
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
