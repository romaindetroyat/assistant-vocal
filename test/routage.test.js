import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choisirModeleAuto } from '../server/routage.js';
import { ecrireValeur, lireValeur } from '../server/store.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';
import { coutUsd, enregistrerUsage, lireUsage } from '../server/usage.js';

const entetes = { 'Content-Type': 'application/json', cookie: `assistant_session=${creerJeton()}` };
function clientSimule(reponses) {
  const requetes = [];
  return { requetes, beta: { messages: { stream(params) {
    requetes.push(structuredClone(params));
    const reponse = reponses.shift();
    const evenements = reponse.content.filter((b) => b.type === 'text').flatMap((b) => [{ type: 'content_block_start', content_block: b }, { type: 'content_block_delta', delta: { type: 'text_delta', text: b.text } }]);
    return { async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; }, async finalMessage() { return reponse; } };
  } } } };
}
const reponseTexte = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });

test('règles : questions simples → Haiku ; rédaction, analyse, pièce jointe, demande longue → Opus', () => {
  for (const q of ['Quelle heure est-il ?', 'Quel temps demain à Toulon ?', "Qu'ai-je à l'agenda lundi ?", 'Ajoute du pain aux courses', 'Combien de temps pour l’aéroport ?', 'Rappelle-moi à 18 h d’appeler Paul'])
    assert.equal(choisirModeleAuto(q).cle, 'haiku', q);
  for (const q of ['Rédige un mail à Kevin pour décaler la réunion', 'Réponds à Jeanne que je suis d’accord', 'Compare ces deux offres', 'Pourquoi le moteur fait ce bruit ?', 'Donne-moi des idées pour le pique-nique'])
    assert.equal(choisirModeleAuto(q).cle, 'opus', q);
  assert.equal(choisirModeleAuto([{ type: 'image', source: {} }, { type: 'text', text: 'ça ?' }]).cle, 'opus');
  assert.equal(choisirModeleAuto('a'.repeat(300)).cle, 'opus');
  for (const q of ['Le résultat du match de Toulon rugby hier soir', 'Quelles sont les actualités ?', 'Combien coûte une Tesla Model Y ?', 'Qui a gagné le Grand Prix ?'])
    assert.equal(choisirModeleAuto(q).cle, 'sonnet', q);
});

test('chat en mode auto : Haiku pour une question simple, Opus pour une tâche ; événement modele', async () => {
  await ecrireValeur('reglages', { modele: 'auto' });
  const client = clientSimule([reponseTexte('Il est 10 h.'), reponseTexte('Voici le mail.')]);
  const app = creerApplication({ client, serveurs: [] });
  let r = await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Quelle heure est-il ?' }] }) });
  const flux = await r.text();
  assert.match(flux, /event: modele[\s\S]*"cle":"haiku"/);
  assert.equal(client.requetes[0].model, 'claude-haiku-5-5');
  assert.ok(client.requetes[0].tools.some((t) => t.name === 'escalader'), 'Haiku peut escalader');
  assert.equal(client.requetes[0].fallbacks, undefined);
  r = await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Rédige un mail à Kevin pour décaler la réunion' }] }) });
  await r.text();
  assert.equal(client.requetes[1].model, 'claude-opus-5-5');
  assert.ok(!client.requetes[1].tools.some((t) => t.name === 'escalader'));
});

test('escalade : Haiku appelle escalader → le tour repart sur Opus, la réponse de Haiku n\'est pas conservée', async () => {
  await ecrireValeur('reglages', { modele: 'auto', concision: 'court' });
  const escalade = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'escalader', input: { raison: 'conseil' } }], usage: { input_tokens: 10, output_tokens: 3 } };
  const client = clientSimule([escalade, reponseTexte('Mon conseil : prenez la 2008 hybride.')]);
  const app = creerApplication({ client, serveurs: [] });
  const r = await app.request('/api/voice/ask', { method: 'POST', headers: entetes, body: JSON.stringify({ message: 'Je change de voiture, tu en penses quoi ?' }) });
  const j = await r.json();
  assert.equal(client.requetes[0].model, 'claude-haiku-5-5');
  assert.equal(client.requetes[1].model, 'claude-opus-5-5');
  assert.equal(j.modele, 'opus');
  assert.match(j.text, /2008/);
  assert.ok(!client.requetes[1].messages.some((m) => m.role === 'assistant'), 'pas de trace de Haiku');
  assert.equal(client.requetes[1].messages.at(-1).role, 'system', 'consigne rejointe pour Opus');
});

test('modèle forcé : le curseur garde la main (pas d\'escalade)', async () => {
  await ecrireValeur('reglages', { modele: 'haiku' });
  const client = clientSimule([reponseTexte('ok')]);
  const app = creerApplication({ client, serveurs: [] });
  await (await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Rédige un poème' }] }) })).text();
  assert.equal(client.requetes[0].model, 'claude-haiku-5-5');
  assert.ok(!client.requetes[0].tools.some((t) => t.name === 'escalader'));
});

test('consommation : coût par modèle (Haiku 40 fois moins cher qu\'Opus en entrée)', async () => {
  const jour = new Date('2030-01-02T10:00:00Z');
  await enregistrerUsage({ input_tokens: 1_000_000, output_tokens: 0 }, 'chat', jour, 'haiku');
  await enregistrerUsage({ input_tokens: 1_000_000, output_tokens: 0 }, 'chat', jour, 'opus');
  const u = await lireValeur('usage:2030-01-02');
  assert.equal(u.modeles.haiku.entree, 1_000_000);
  assert.equal(Number(coutUsd(u).toFixed(2)), 4.1);
  assert.equal(Number(coutUsd({ entree: 1_000_000 }).toFixed(2)), 4, 'jours anciens : tarif Opus');
  const l = await lireUsage(1, jour);
  assert.ok(l.tarifsModeles.haiku);
});

test('tâches de fond : brief sur Sonnet, extraction sur Haiku, cache court (pas d\'écriture 1 h)', async () => {
  await ecrireValeur('reglages', { modele: 'opus' });
  const { tourEphemere } = await import('../server/brief.js');
  const client = clientSimule([reponseTexte('Brief.'), reponseTexte('[]')]);
  await tourEphemere({ client, message: 'Prépare le brief.', consigne: 'x' });
  await tourEphemere({ client, message: 'Liste.', consigne: 'y', modele: 'haiku' });
  assert.equal(client.requetes[0].model, 'claude-sonnet-5-5', 'le réglage Opus ne s\'applique pas aux tâches de fond');
  assert.equal(client.requetes[1].model, 'claude-haiku-5-5');
  assert.equal(client.requetes[0].system[0].cache_control.ttl, undefined, 'cache 5 min');
});
