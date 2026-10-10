import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerJeton as creerJetonAppareil } from '../server/jetons.js';
import { ecrireValeur, listerConversations, lireConversation, supprimerConversation } from '../server/store.js';
import { repondreRaccourci, conversationSiri, formaterPosition, REPONSE_ATTENTE, FENETRE_MS } from '../server/raccourci.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const cookie = `assistant_session=${creerJeton()}`;

// Client Anthropic simulé ; `delaiMs` retarde le flux pour tester le dépassement de délai.
function clientSimule(reponses, { delaiMs = 0 } = {}) {
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
      return {
        async *[Symbol.asyncIterator]() { if (delaiMs) await new Promise((r) => setTimeout(r, delaiMs)); for (const e of evenements) yield e; },
        async finalMessage() { return reponse; },
      };
    } } },
  };
}
const REPONSE = 'Ta prochaine réunion est à 14 h avec Takeoff.';
const reponses = (texte = REPONSE) => [{ stop_reason: 'end_turn', content: [{ type: 'text', text: texte }] }];
const avecPush = (f) => async () => { process.env.VAPID_PUBLIC_KEY = 'pub-test'; process.env.VAPID_PRIVATE_KEY = 'priv-test'; try { await f(); } finally { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; } };
const viderConversations = async () => { for (const c of await listerConversations()) await supprimerConversation(c.id); };

test('repondreRaccourci : réponse courte, effort voix, consigne Siri + concision + position, conversation « Siri » réutilisée puis nouvelle après 30 min', async () => {
  await viderConversations();
  const envois = []; const envoyer = async (n) => { envois.push(n); return 1; };
  const client = clientSimule(reponses());
  const r1 = await repondreRaccourci({ client, texte: 'Quelle est ma prochaine réunion ?', position: { lat: 43.12345678, lng: 5.9 }, envoyer });
  assert.equal(r1.texte, REPONSE);
  assert.equal(r1.enAttente, false);
  const req = client.requetes[0];
  assert.deepEqual(req.output_config, { effort: 'low' });
  const systeme = req.messages.find((m) => m.role === 'system');
  assert.match(systeme.content, /^Réponse énoncée par Siri : une à deux phrases, pas de mise en forme, pas de liens\. /);
  assert.match(systeme.content, /Une à deux phrases courtes/, 'concision des réglages (court par défaut)');
  assert.match(systeme.content, /Position actuelle de l'utilisateur : 43\.12346, 5\.90000\./);
  assert.equal(req.messages.find((m) => m.role === 'user').content[0].text, 'Quelle est ma prochaine réunion ?');
  assert.equal(envois.length, 0, 'pas de push quand la réponse est rendue à temps');

  let liste = await listerConversations();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].titre, 'Siri');
  assert.equal(liste[0].id, r1.conversationId);

  // Deuxième question dans la demi-heure : même conversation (le fil est conservé)
  const r2 = await repondreRaccourci({ client: clientSimule(reponses('Avec Kevin et Marie.')), texte: 'Avec qui ?', envoyer });
  assert.equal(r2.conversationId, r1.conversationId);
  const conv = await lireConversation(r1.conversationId);
  assert.equal(conv.messages.filter((m) => m.role === 'user').length, 2);
  assert.ok(!conv.messages.some((m) => m.role === 'system'), 'la consigne n\'est pas conservée dans l\'historique');

  // Plus de 30 min plus tard : nouvelle conversation « Siri », l'ancienne reste
  const plusTard = new Date(Date.now() + FENETRE_MS + 60_000);
  const r3 = await repondreRaccourci({ client: clientSimule(reponses()), texte: 'Et demain ?', envoyer, maintenant: plusTard });
  assert.notEqual(r3.conversationId, r1.conversationId);
  liste = await listerConversations();
  assert.equal(liste.length, 2);
  assert.ok(liste.every((c) => c.titre === 'Siri'));
  assert.equal((await conversationSiri()).id, r3.conversationId, 'la plus récente est reprise');

  // Sans position ni texte
  assert.equal(formaterPosition(null), null);
  assert.equal(formaterPosition({ lat: 'x', lng: 1 }), null);
  assert.equal(formaterPosition({ latitude: 48.8, longitude: 2.3 }), '48.80000, 2.30000');
  assert.equal(formaterPosition('Toulon'), 'Toulon');
  await assert.rejects(repondreRaccourci({ client, texte: '   ', envoyer }), (e) => e.status === 400 && /texte requis/.test(e.message));
});

test('repondreRaccourci : dépassement du délai → phrase d\'attente, tour terminé en arrière-plan, push « Réponse de l\'assistant »', avecPush(async () => {
  await viderConversations();
  const envois = []; const envoyer = async (n) => { envois.push(n); return 1; };
  const enAttente = []; const attendre = (p) => enAttente.push(p);
  const longue = 'Voici la réponse complète. '.repeat(12).trim();
  const r = await repondreRaccourci({ client: clientSimule(reponses(longue), { delaiMs: 120 }), texte: 'Résume mes mails', envoyer, attendre, delaiMs: 20 });
  assert.equal(r.texte, REPONSE_ATTENTE);
  assert.equal(r.enAttente, true);
  assert.ok(r.conversationId);
  assert.equal(envois.length, 0, 'le push n\'est pas encore parti');
  assert.equal(enAttente.length, 1, 'la suite du tour est confiée à attendre (waitUntil)');
  await Promise.all(enAttente);
  assert.equal(envois.length, 1);
  assert.equal(envois[0].titre, "Réponse de l'assistant");
  assert.equal(envois[0].url, `/app?conversation=${r.conversationId}`);
  assert.ok(envois[0].corps.length <= 200 && longue.startsWith(envois[0].corps.replace(/…$/, '')));
  const conv = await lireConversation(r.conversationId);
  assert.equal(conv.messages.at(-1).role, 'assistant', 'la réponse complète est sauvegardée dans la conversation « Siri »');

  // Même dépassement sans `attendre` : promesse flottante, le push part quand même
  const r2 = await repondreRaccourci({ client: clientSimule(reponses(), { delaiMs: 60 }), texte: 'Encore', envoyer, delaiMs: 10 });
  assert.equal(r2.enAttente, true);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(envois.length, 2);
  assert.equal(envois[1].corps, REPONSE);
}));

test('repondreRaccourci : erreur API avant le délai → exception, conversation « Siri » tout de même sauvegardée', async () => {
  await viderConversations();
  await assert.rejects(repondreRaccourci({ client: clientSimule([]), texte: 'Bonjour', envoyer: async () => 1 }), /API indisponible/);
  const liste = await listerConversations();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].titre, 'Siri');
  const conv = await lireConversation(liste[0].id);
  assert.equal(conv.messages.at(-1).role, 'user', 'le message dicté est conservé malgré l\'erreur');
});

test('POST /api/raccourci : jeton d\'appareil ou cookie, 401 sans jeton, 400 texte vide, réponse { texte, enAttente }', async () => {
  await viderConversations(); await ecrireValeur('jetons-appareils', []);
  const app = creerApplication({ client: () => clientSimule(reponses()), serveurs: [] });
  const { jeton } = await creerJetonAppareil('iPhone');
  const json = (corps, headers = {}) => app.request('/api/raccourci', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corps) });

  let r = await json({ texte: 'Sans jeton' });
  assert.equal(r.status, 401);
  r = await json({ texte: 'Mauvais jeton' }, { Authorization: `Bearer ${'a'.repeat(64)}` });
  assert.equal(r.status, 401);
  r = await json({ texte: '  ' }, { Authorization: `Bearer ${jeton}` });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erreur, /texte requis/);
  r = await app.request('/api/raccourci', { method: 'POST', headers: { Authorization: `Bearer ${jeton}` }, body: 'pas du json' });
  assert.equal(r.status, 400);

  r = await json({ texte: 'Quelle est ma prochaine réunion ?' }, { Authorization: `Bearer ${jeton}` });
  assert.equal(r.status, 200);
  const rep = await r.json();
  assert.equal(rep.texte, REPONSE);
  assert.equal(rep.enAttente, false);
  assert.ok(rep.conversationId);

  // Cookie de session (bouton « Tester » de Mes outils) : même conversation « Siri »
  r = await json({ texte: 'Dis bonjour en trois mots' }, { cookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).conversationId, rep.conversationId);
  assert.equal((await listerConversations()).length, 1);
});
