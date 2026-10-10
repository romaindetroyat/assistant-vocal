import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consoliderMemoire, consolidationHebdo, lireJournalMemoire, extraireJson, validerProposition, MAX_ENTREES } from '../server/memoire-consolidation.js';
import { lireMemoire, remplacerMemoire, noter } from '../server/memoire.js';
import { ecrireValeur } from '../server/store.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

// Client Anthropic simulé : renvoie le texte fourni, enregistre la requête. Aucun réseau.
function clientSimule(texte) {
  const requetes = [];
  return { requetes, beta: { messages: { async create(params) { requetes.push(structuredClone(params)); return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof texte === 'function' ? texte(params) : texte }] }; } } } };
}

async function memoireDeTest() {
  await remplacerMemoire([]);
  await ecrireValeur('memoire-journal', []);
  await ecrireValeur('memoire-consolidation', null);
  const faits = [
    ['personne', 'kevin', 'Kevin est développeur chez TakeOff.'],
    ['personne', 'kevin2', 'Kevin est CTO de TakeOff.'],
    ['preference', 'cafe', 'Il boit son café sans sucre.'],
    ['preference', '', 'Il prend son café sans sucre.'],
    ['fait', '', 'Il a un rendez-vous chez le dentiste mardi.'],
    ['projet', 'exail', 'Il prépare une proposition pour Exail.'],
    ['habitude', 'sport', 'Il court le dimanche matin.'],
    ['personne', 'jeanne', 'Jeanne est sa comptable.'],
  ];
  for (const [categorie, cle, texte] of faits) await noter({ categorie, cle, texte });
  return lireMemoire();
}

test('consolidation : fusion effective, identifiants préservés, journal écrit, requête bien formée', async () => {
  const avant = await memoireDeTest();
  assert.equal(avant.length, 8);
  const client = clientSimule('Voici la mémoire :\n```json\n' + JSON.stringify([
    { categorie: 'personne', cle: 'kevin', texte: 'Kevin est CTO de TakeOff.' },
    { categorie: 'preference', cle: 'cafe', texte: 'Il boit son café sans sucre.' },
    { categorie: 'projet', cle: 'exail', texte: 'Il prépare une proposition pour Exail.' },
    { categorie: 'habitude', cle: 'sport', texte: 'Il court le dimanche matin.' },
    { categorie: 'personne', cle: 'jeanne', texte: 'Jeanne est sa comptable.' },
  ]) + '\n```');
  const j = await consoliderMemoire({ client, maintenant: new Date('2026-10-11T08:00:00Z') });
  assert.equal(j.ok, true);
  assert.equal(j.avant, 8); assert.equal(j.apres, 5);
  assert.equal(j.fusionnees, 1, 'kevin reformulé (clé conservée, texte le plus récent)');
  assert.equal(j.supprimees, 3, 'kevin2, café dupliqué, dentiste');
  assert.ok(j.resume.some((l) => /dentiste/.test(l)));

  const apres = await lireMemoire();
  assert.equal(apres.length, 5);
  const idsAvant = Object.fromEntries(avant.map((m) => [m.cle || m.texte, m.id]));
  assert.equal(apres.find((m) => m.cle === 'cafe').id, idsAvant.cafe, 'id préservé (même texte)');
  assert.equal(apres.find((m) => m.cle === 'kevin').id, idsAvant.kevin, 'id préservé (même clé)');
  assert.equal(apres.find((m) => m.cle === 'kevin').creeLe, avant.find((m) => m.cle === 'kevin').creeLe);
  assert.match(apres.find((m) => m.cle === 'kevin').texte, /CTO/);

  const req = client.requetes[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.deepEqual(req.output_config, { effort: 'low' });
  assert.equal(req.max_tokens, 4000);
  assert.equal(req.tools, undefined);
  assert.equal(req.messages.length, 1, 'pas de prefill');
  assert.match(req.messages[0].content, /"majLe"/);
  assert.match(req.messages[0].content, /"vu"/);
  assert.equal((await lireJournalMemoire())[0].apres, 5);
});

test('consolidation : JSON invalide → mémoire intacte, journal d\'échec', async () => {
  const avant = await memoireDeTest();
  const j = await consoliderMemoire({ client: clientSimule('Désolé, je ne peux pas.') });
  assert.equal(j.ok, false);
  assert.deepEqual(await lireMemoire(), avant);
  // Catégorie inconnue ou texte vide → refus aussi
  const j2 = await consoliderMemoire({ client: clientSimule(JSON.stringify([{ categorie: 'autre', cle: '', texte: 'x' }])) });
  assert.equal(j2.ok, false);
  const j3 = await consoliderMemoire({ client: clientSimule(JSON.stringify([{ categorie: 'fait', cle: '', texte: '' }])) });
  assert.equal(j3.ok, false);
  assert.deepEqual(await lireMemoire(), avant);
  const journal = await lireJournalMemoire();
  assert.equal(journal.length, 3);
  assert.match(journal[0].resume[0], /invalide/);
  // Erreur réseau simulée → journal d'échec aussi
  const j4 = await consoliderMemoire({ client: { beta: { messages: { create: async () => { throw new Error('panne'); } } } } });
  assert.equal(j4.ok, false); assert.match(j4.resume[0], /panne/);
  assert.deepEqual(await lireMemoire(), avant);
});

test('consolidation : rien en dessous de 8 entrées', async () => {
  await remplacerMemoire([]);
  await noter({ categorie: 'fait', cle: '', texte: 'Un seul fait.' });
  const client = clientSimule('[]');
  assert.equal(await consoliderMemoire({ client }), null);
  assert.equal(validerProposition([]), null, 'une liste vide ne doit jamais effacer la mémoire');
  assert.equal(client.requetes.length, 0);
});

test('consolidation : plafond de 60 entrées', async () => {
  await memoireDeTest();
  const trop = Array.from({ length: 80 }, (_, i) => ({ categorie: 'fait', cle: '', texte: `Fait numéro ${i}.` }));
  const j = await consoliderMemoire({ client: clientSimule(JSON.stringify(trop)) });
  assert.equal(j.ok, true);
  assert.equal((await lireMemoire()).length, MAX_ENTREES);
  assert.ok(j.resume.length <= 10, 'résumé court');
  assert.equal(validerProposition(trop).length, 60);
  assert.equal(validerProposition(extraireJson('bla [1, 2] bla')), null, 'tableau sans objets → refusé');
  assert.deepEqual(extraireJson('texte avant [{"a":1}] après'), [{ a: 1 }]);
});

test('garde hebdomadaire : une fois par semaine, à partir de 6 h Paris', async () => {
  const faits = (await memoireDeTest()).map(({ categorie, cle, texte }) => ({ categorie, cle: cle || '', texte }));
  const client = clientSimule(JSON.stringify(faits));
  const lundi7h = new Date('2026-10-12T05:00:00Z'); // 7 h Paris (CEST)
  assert.equal(await consolidationHebdo({ client, maintenant: new Date('2026-10-12T02:00:00Z') }), false, '4 h Paris : trop tôt');
  assert.equal(await consolidationHebdo({ client, maintenant: lundi7h }), true);
  assert.equal(client.requetes.length, 1);
  assert.equal(await consolidationHebdo({ client, maintenant: new Date('2026-10-15T10:00:00Z') }), false, '3 jours plus tard : déjà fait');
  assert.equal(await consolidationHebdo({ client, maintenant: new Date('2026-10-19T05:00:00Z') }), true, '7 jours plus tard');
  assert.equal(client.requetes.length, 2);
});

test('routes : consolidation à la demande et journal', async () => {
  await memoireDeTest();
  const client = clientSimule(JSON.stringify([{ categorie: 'personne', cle: 'kevin', texte: 'Kevin est CTO de TakeOff.' }]));
  const app = creerApplication({ client, serveurs: [] });
  const cookie = `assistant_session=${creerJeton()}`;
  const r = await app.request('/api/memoire/consolider', { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.apres, 1);
  const r2 = await app.request('/api/memoire/journal', { headers: { cookie } });
  assert.equal((await r2.json()).length, 1);
  assert.equal((await app.request('/api/memoire/journal')).status, 401);
});
