// Comptes Google : ajout depuis le menu de l'app (retour), compte Workspace (alias, refus du domaine), reconnexion, retrait.
import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireValeur } from '../server/store.js';
import { enregistrerConfigGoogle, demarrerConnexionGoogle, terminerConnexionGoogle, retirerCompte, listerComptes, resoudreCompte } from '../server/google.js';
import { executerOutilGmail } from '../server/gmail.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const PERSO = 'perso@exemple.fr';
const PRO = 'pro@societe.example';
const MERIDIA = 'romain@meridia.tl';
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
// Google simulé : jetons, identité du compte qui se connecte, révocation.
const googleSimule = (adresse) => async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  if (u.includes('userinfo')) return json({ email: adresse });
  if (u.includes('/revoke')) return new Response(null, { status: 200 });
  return json({ error: { message: `inattendu ${u}` } });
};
async function connecter(adresse, retour) {
  const state = new URL(await demarrerConnexionGoogle('https://w.test/oauth/google/callback', { retour })).searchParams.get('state');
  return terminerConnexionGoogle({ code: 'c', state }, googleSimule(adresse));
}

test('compte Workspace meridia : ajout, alias « meridia », reconnexion sans doublon ni changement d\'ordre, retrait', async () => {
  await enregistrerConfigGoogle({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'secret' });
  const loin = Date.now() + 3_600_000;
  await ecrireValeur('google-comptes', [{ email: PERSO, access_token: 'A1', expires_at: loin, ajouteLe: '2026-10-01' }, { email: PRO, access_token: 'A2', expires_at: loin }]);
  assert.equal(await connecter('Romain@Meridia.tl', 'app'), MERIDIA);
  assert.deepEqual((await listerComptes()).map((c) => c.email), [PERSO, PRO, MERIDIA]);
  assert.equal(await resoudreCompte('meridia'), MERIDIA);
  assert.equal(await resoudreCompte('societe'), PRO, 'comptes existants inchangés');
  assert.match(await executerOutilGmail('gmail_comptes', {}), /romain@meridia\.tl/);
  // Reconnexion d'un compte existant : jeton rafraîchi à la même place, pas de doublon.
  await connecter(PERSO);
  const apres = await listerComptes();
  assert.deepEqual(apres.map((c) => c.email), [PERSO, PRO, MERIDIA]);
  assert.equal(apres[0].ajouteLe, '2026-10-01');
  assert.equal(apres[0].access_token, 'AT');
  await retirerCompte(MERIDIA, googleSimule(MERIDIA));
  assert.deepEqual((await listerComptes()).map((c) => c.email), [PERSO, PRO]);
  await ecrireValeur('google-comptes', []);
});

test('ajout depuis le menu de l\'app : retour vers /app ; domaine Workspace qui bloque → message explicite', async () => {
  await enregistrerConfigGoogle({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'secret' });
  const app = creerApplication({ client: {}, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const { url } = await (await app.request('/api/google/connect', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ retour: 'app' }) })).json();
  const state = new URL(url).searchParams.get('state');
  const r = await app.request(`/oauth/google/callback?error=admin_policy_enforced&state=${state}`, { headers: { cookie } });
  assert.equal(r.status, 302);
  const loc = decodeURIComponent(r.headers.get('location'));
  assert.match(loc, /^\/app\?google_erreur=Le domaine Google Workspace bloque l'application \(ID client abc\.apps/);
  assert.match(loc, /admin\.google\.com/);
});
