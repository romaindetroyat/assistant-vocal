import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enregistrerConfigGoogle, demarrerConnexionGoogle, terminerConnexionGoogle, listerComptes, jetonAcces, resoudreCompte, retirerCompte } from '../server/google.js';
import { executerOutilGmail } from '../server/gmail.js';
import { outilsLocauxDisponibles, executerOutilLocal } from '../server/tools.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const b64url = (s) => Buffer.from(s).toString('base64url');
function googleSimule(journal) {
  return async (url, init = {}) => {
    const u = String(url); journal.push({ u, init });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') return json({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 10 });
      if (p.get('grant_type') === 'refresh_token') return json({ access_token: 'AT2', expires_in: 3600 });
    }
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) return json({ email: 'Romain@Perso.fr' });
    if (u.includes('/messages?')) return json({ messages: [{ id: 'm1' }, { id: 'm2' }] });
    if (u.includes('/messages/m1?') && u.includes('format=full')) return json({ id: 'm1', threadId: 't1', payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'Kevin <kevin@x.fr>' }, { name: 'Subject', value: 'Réunion' }, { name: 'Date', value: 'Thu, 9 Oct 2026' }, { name: 'Message-ID', value: '<id1@x>' }], parts: [{ mimeType: 'text/html', body: { data: b64url('<p>Bonjour <b>Romain</b></p>') } }] } });
    if (u.includes('/messages/m')) return json({ id: u.includes('m1') ? 'm1' : 'm2', threadId: 't1', snippet: 'extrait…', payload: { headers: [{ name: 'From', value: 'Kevin <kevin@x.fr>' }, { name: 'Subject', value: 'Réunion' }, { name: 'Date', value: 'Thu, 9 Oct 2026' }, { name: 'Message-ID', value: '<id1@x>' }, { name: 'To', value: 'romain@perso.fr' }] } });
    if (u.endsWith('/messages/send')) return json({ id: 'envoye1' });
    if (u.endsWith('/drafts')) return json({ id: 'brouillon1' });
    if (u.includes('/revoke')) return new Response(null, { status: 200 });
    return json({ error: { message: `inattendu ${u}` } }, 500);
  };
}

test('Google : config, autorisation, échange, comptes, rafraîchissement, outils Gmail', async () => {
  const journal = []; const f = googleSimule(journal);
  await assert.rejects(() => enregistrerConfigGoogle({ clientId: 'x', clientSecret: 'y' }), /googleusercontent/);
  await enregistrerConfigGoogle({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'secret' });
  const url = new URL(await demarrerConnexionGoogle('https://w.test/oauth/google/callback'));
  assert.equal(url.searchParams.get('client_id'), 'abc.apps.googleusercontent.com');
  assert.match(url.searchParams.get('scope'), /gmail\.modify/);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  const state = url.searchParams.get('state');
  await assert.rejects(() => terminerConnexionGoogle({ code: 'c', state: 'faux' }, f), /inconnue/);
  assert.equal(await terminerConnexionGoogle({ code: 'c', state }, f), 'romain@perso.fr');
  assert.deepEqual((await listerComptes()).map((c) => c.email), ['romain@perso.fr']);
  assert.equal(await jetonAcces('romain@perso.fr', f), 'AT2', 'jeton expirant → rafraîchi');
  assert.equal(await resoudreCompte('perso'), 'romain@perso.fr');
  assert.equal(await resoudreCompte(''), 'romain@perso.fr');
  await assert.rejects(() => resoudreCompte('altapyx'), /introuvable/);

  assert.ok((await outilsLocauxDisponibles()).some((t) => t.name === 'gmail_rechercher'));
  const recherche = await executerOutilGmail('gmail_rechercher', { compte: '', requete: 'from:kevin', max: 5 }, f);
  assert.match(recherche, /id m1 .*Kevin.*Réunion/);
  const lecture = await executerOutilGmail('gmail_lire', { compte: 'perso', id: 'm1' }, f);
  assert.match(lecture, /Objet : Réunion/); assert.match(lecture, /Bonjour Romain/); assert.ok(!lecture.includes('<b>'));
  const reponse = await executerOutilGmail('gmail_repondre', { compte: 'perso', id: 'm1', corps: 'Ça marche, à jeudi.', repondre_a_tous: false }, f);
  assert.match(reponse, /kevin@x.fr/);
  const envoi = JSON.parse(journal.findLast((j) => j.u.endsWith('/messages/send')).init.body);
  assert.equal(envoi.threadId, 't1');
  const mime = Buffer.from(envoi.raw, 'base64url').toString();
  assert.match(mime, /In-Reply-To: <id1@x>/); assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(await executerOutilGmail('gmail_envoyer', { compte: 'perso', a: 'a@b.fr', cc: '', objet: 'Test', corps: 'Hello' }, f), /envoyé/);
  assert.match(await executerOutilLocal('gmail_comptes', {}), /romain@perso.fr/);
  await retirerCompte('romain@perso.fr', f);
  assert.deepEqual(await listerComptes(), []);
  assert.ok(!(await outilsLocauxDisponibles()).some((t) => t.name.startsWith('gmail_')));
});

test('routes Google : état, connexion, callback', async () => {
  const app = creerApplication({ client: {}, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const g = await (await app.request('/api/google', { headers: { cookie } })).json();
  assert.equal(g.configure, true); assert.match(g.redirectUri, /\/oauth\/google\/callback$/);
  const { url } = await (await app.request('/api/google/connect', { method: 'POST', headers: { cookie } })).json();
  assert.match(url, /^https:\/\/accounts\.google\.com\//);
  const r = await app.request('/oauth/google/callback?error=access_denied', { headers: { cookie } });
  assert.equal(r.status, 400);
});

test('signatures : définies par compte, ajoutées aux envois, réponses et brouillons, pas en double', async () => {
  const { enregistrerConfigGoogle, demarrerConnexionGoogle, terminerConnexionGoogle, definirSignature, retirerCompte } = await import('../server/google.js');
  const journal = []; const f = googleSimule(journal);
  await enregistrerConfigGoogle({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'secret' });
  const state = new URL(await demarrerConnexionGoogle('https://w.test/oauth/google/callback')).searchParams.get('state');
  await terminerConnexionGoogle({ code: 'c', state }, f);
  await assert.rejects(() => definirSignature('inconnu@x.fr', 'x'), /inconnu/);
  assert.match(await executerOutilGmail('gmail_signature', { compte: 'perso', signature: 'Romain de Troyat\nTakeOff' }, f), /enregistrée/);
  assert.match(await executerOutilGmail('gmail_signature', { compte: '', signature: '' }, f), /TakeOff/);
  await executerOutilGmail('gmail_envoyer', { compte: 'perso', a: 'a@b.fr', cc: '', objet: 'Test', corps: 'Bonjour,\nvoici le document.' }, f);
  const mime = Buffer.from(JSON.parse(journal.findLast((j) => j.u.endsWith('/messages/send')).init.body).raw, 'base64url').toString();
  const corps = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString();
  assert.equal(corps, 'Bonjour,\nvoici le document.\n\n--\nRomain de Troyat\nTakeOff');
  await executerOutilGmail('gmail_brouillon', { compte: 'perso', a: 'a@b.fr', objet: 'T', corps: 'Déjà signé\n\n--\nRomain de Troyat\nTakeOff' }, f);
  const mime2 = Buffer.from(JSON.parse(journal.findLast((j) => j.u.endsWith('/drafts')).init.body).message.raw, 'base64url').toString();
  assert.equal((Buffer.from(mime2.split('\r\n\r\n')[1], 'base64').toString().match(/TakeOff/g) || []).length, 1, 'pas de double signature');
  assert.match(await executerOutilGmail('gmail_signature', { compte: 'perso', signature: '' }, f), /effacée/);
  await retirerCompte('romain@perso.fr', f);
});
