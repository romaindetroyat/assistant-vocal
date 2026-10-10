import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerJeton as creerJetonAppareil, verifierJeton, revoquerJeton, listerJetons, jetonDepuisEntete } from '../server/jetons.js';
import { lireValeur, ecrireValeur, listerConversations, lireConversation, supprimerConversation } from '../server/store.js';
import { traiterPartage, composerTexte, CONSIGNE_PAR_DEFAUT } from '../server/partage.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const cookie = `assistant_session=${creerJeton()}`;

test('jetons d\'appareil : création, hachage, vérification, dernier usage, révocation', async () => {
  await ecrireValeur('jetons-appareils', []);
  const { id, nom, jeton } = await creerJetonAppareil('  iPhone de Romain ');
  assert.equal(nom, 'iPhone de Romain');
  assert.match(jeton, /^[0-9a-f]{64}$/, '32 octets en hexadécimal');
  const stockes = await lireValeur('jetons-appareils');
  assert.equal(stockes.length, 1);
  assert.equal(stockes[0].id, id);
  assert.match(stockes[0].hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stockes[0].hash, jeton, 'le jeton n\'est pas stocké en clair');
  assert.ok(!JSON.stringify(stockes).includes(jeton));
  assert.equal(stockes[0].dernierUsage, null);

  const entree = await verifierJeton(jeton);
  assert.equal(entree.id, id);
  assert.equal(entree.hash, undefined, 'le hash ne sort pas');
  assert.ok(entree.dernierUsage, 'dernier usage mis à jour');
  assert.equal(await verifierJeton('0'.repeat(64)), null);
  assert.equal(await verifierJeton('pas-un-jeton'), null);
  assert.equal(await verifierJeton(undefined), null);

  assert.equal(jetonDepuisEntete(`Bearer ${jeton}`), jeton);
  assert.equal(jetonDepuisEntete(`bearer ${jeton.toUpperCase()}`), jeton);
  assert.equal(jetonDepuisEntete('Basic abc'), null);

  const liste = await listerJetons();
  assert.equal(liste.length, 1);
  assert.ok(!('hash' in liste[0]));
  assert.equal(await revoquerJeton('inconnu'), false);
  assert.equal(await revoquerJeton(id), true);
  assert.equal(await verifierJeton(jeton), null, 'révoqué : refusé');
  assert.deepEqual(await listerJetons(), []);
  await assert.rejects(creerJetonAppareil('   '), /Nom/);
});

test('routes /api/jetons : cookie obligatoire, liste sans hash, création puis révocation', async () => {
  await ecrireValeur('jetons-appareils', []);
  const app = creerApplication({ client: {}, serveurs: [] });
  let r = await app.request('/api/jetons');
  assert.equal(r.status, 401);
  r = await app.request('/api/jetons', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ nom: 'iPhone' }) });
  assert.equal(r.status, 201);
  const cree = await r.json();
  assert.match(cree.jeton, /^[0-9a-f]{64}$/);
  r = await app.request('/api/jetons', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400);
  r = await app.request('/api/jetons', { headers: { cookie } });
  const liste = await r.json();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].nom, 'iPhone');
  assert.ok(!('hash' in liste[0]) && !('jeton' in liste[0]));
  // Un jeton d'appareil ne donne pas accès aux routes de gestion
  r = await app.request('/api/jetons', { headers: { Authorization: `Bearer ${cree.jeton}` } });
  assert.equal(r.status, 401);
  r = await app.request(`/api/jetons/${cree.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r.status, 200);
  r = await app.request(`/api/jetons/${cree.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r.status, 404);
});

// Client Anthropic simulé (même principe que brief.test.js).
function clientSimule(reponses) {
  const requetes = [];
  return {
    requetes,
    beta: { messages: { stream(params) {
      requetes.push(structuredClone(params));
      const reponse = reponses.shift();
      if (!reponse) throw new Error('API indisponible (simulation)');
      const evenements = [];
      for (const bloc of reponse.content) {
        evenements.push({ type: 'content_block_start', content_block: bloc });
        if (bloc.type === 'text') evenements.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: bloc.text } });
      }
      return { async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; }, async finalMessage() { return reponse; } };
    } } },
  };
}
const REPONSE = "Article sur les Workers Cloudflare : trois points clés. J'ai ajouté la tâche « lire la documentation ».";
const reponses = () => [{ stop_reason: 'end_turn', content: [{ type: 'text', text: REPONSE }] }];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const avecPush = (f) => async () => { process.env.VAPID_PUBLIC_KEY = 'pub-test'; process.env.VAPID_PRIVATE_KEY = 'priv-test'; try { await f(); } finally { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; } };
const viderConversations = async () => { for (const c of await listerConversations()) await supprimerConversation(c.id); };

test('traiterPartage : conversation « Partages » créée puis réutilisée, image + texte, consigne par défaut, effort voix, push', avecPush(async () => {
  await viderConversations();
  const envois = []; const envoyer = async (n) => { envois.push(n); return 1; };
  const client = clientSimule(reponses());
  const r1 = await traiterPartage({ client, texte: 'Les Workers Cloudflare…', url: 'https://exemple.fr/article', image: { media_type: 'image/png', data: PNG }, envoyer });
  assert.equal(r1.texte, REPONSE);
  const req = client.requetes[0];
  assert.deepEqual(req.output_config, { effort: 'low' });
  const message = req.messages.find((m) => m.role === 'user');
  assert.equal(message.content[0].type, 'image');
  assert.equal(message.content[0].source.media_type, 'image/png');
  assert.equal(message.content[1].type, 'text');
  assert.match(message.content[1].text, /^Contenu partagé depuis l'iPhone\.\nURL : https:\/\/exemple\.fr\/article\nTexte : Les Workers Cloudflare…\nConsigne : Fais ce qui est le plus utile/);
  assert.equal(envois.length, 1);
  assert.equal(envois[0].titre, 'Partage traité');
  assert.equal(envois[0].url, `/app?conversation=${r1.conversationId}`);
  assert.ok(envois[0].corps.length <= 200 && REPONSE.startsWith(envois[0].corps));

  const liste = await listerConversations();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].titre, 'Partages');
  assert.equal(liste[0].id, r1.conversationId);

  const r2 = await traiterPartage({ client: clientSimule(reponses()), url: 'https://exemple.fr/autre', consigne: 'Ajoute à mes tâches', envoyer });
  assert.equal(r2.conversationId, r1.conversationId, 'même conversation au second appel');
  assert.equal((await listerConversations()).length, 1);
  const conv = await lireConversation(r1.conversationId);
  assert.equal(conv.messages.filter((m) => m.role === 'user').length, 2);
  assert.match(conv.messages.at(-2).content[0].text, /Consigne : Ajoute à mes tâches$/);
  assert.ok(!conv.messages.at(-2).content[0].text.includes('Texte :'), 'pas de ligne Texte sans texte');
  assert.equal(composerTexte({ texte: 'a' }), "Contenu partagé depuis l'iPhone.\nTexte : a\nConsigne : " + CONSIGNE_PAR_DEFAUT);
}));

test('traiterPartage : sans push configuré, pas d\'envoi ; sans contenu ou HEIC, refus', async () => {
  await viderConversations();
  const envois = []; const envoyer = async (n) => { envois.push(n); return 1; };
  const r = await traiterPartage({ client: clientSimule(reponses()), texte: 'Bonjour', envoyer });
  assert.equal(r.texte, REPONSE);
  assert.equal(envois.length, 0);
  await assert.rejects(traiterPartage({ client: clientSimule(reponses()), envoyer }), /Rien à partager/);
  await assert.rejects(traiterPartage({ client: clientSimule(reponses()), image: { media_type: 'image/heic', data: PNG }, envoyer }), /HEIC.*Convertir l'image/);
  await assert.rejects(traiterPartage({ client: clientSimule(reponses()), image: { media_type: 'application/pdf', data: PNG }, envoyer }), /Type d'image non pris en charge/);
});

test('POST /api/partage : jeton d\'appareil ou cookie, JSON et multipart, 401 sans jeton, HEIC refusé', avecPush(async () => {
  await viderConversations(); await ecrireValeur('jetons-appareils', []);
  const app = creerApplication({ client: () => clientSimule(reponses()), serveurs: [] });
  const { jeton } = await creerJetonAppareil('iPhone');
  const json = (corps, headers = {}) => app.request('/api/partage', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corps) });

  let r = await json({ texte: 'Sans jeton' });
  assert.equal(r.status, 401);
  r = await json({ texte: 'Mauvais jeton' }, { Authorization: `Bearer ${'f'.repeat(64)}` });
  assert.equal(r.status, 401);

  r = await json({ texte: 'Les Workers Cloudflare…', url: 'https://exemple.fr/article', image: { media_type: 'image/png', data: PNG } }, { Authorization: `Bearer ${jeton}` });
  assert.equal(r.status, 200);
  const rep = await r.json();
  assert.equal(rep.texte, REPONSE);
  assert.ok(rep.conversationId);
  assert.ok((await listerJetons())[0].dernierUsage, 'dernier usage mis à jour par la requête');

  // Multipart (PWA / raccourci en formulaire) avec cookie de session
  const form = new FormData();
  form.set('texte', 'Capture'); form.set('consigne', 'Que vois-tu ?');
  form.set('fichier', new File([Buffer.from(PNG, 'base64')], 'capture.png', { type: 'image/png' }));
  r = await app.request('/api/partage', { method: 'POST', headers: { cookie }, body: form });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).conversationId, rep.conversationId, 'même conversation « Partages »');
  const conv = await lireConversation(rep.conversationId);
  const dernier = conv.messages.filter((m) => m.role === 'user').at(-1);
  assert.equal(dernier.content[0].type, 'image');
  assert.equal(dernier.content[0].source.data, PNG);
  assert.match(dernier.content[1].text, /Consigne : Que vois-tu \?$/);

  // HEIC : refus explicite (415) avec consigne de conversion
  const heic = new FormData(); heic.set('fichier', new File([Buffer.from(PNG, 'base64')], 'IMG_0001.HEIC', { type: 'image/heic' }));
  r = await app.request('/api/partage', { method: 'POST', headers: { Authorization: `Bearer ${jeton}` }, body: heic });
  assert.equal(r.status, 415);
  assert.match((await r.json()).erreur, /HEIC/);
  r = await json({}, { Authorization: `Bearer ${jeton}` });
  assert.equal(r.status, 400);
  // Le jeton d'appareil ne couvre pas les autres routes
  r = await app.request('/api/conversations', { headers: { Authorization: `Bearer ${jeton}` } });
  assert.equal(r.status, 401);
}));
