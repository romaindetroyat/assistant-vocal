import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireReglages, modifierReglages, modeleClaude, consigneConcision, CONCISIONS, MODELES } from '../server/reglages.js';
import { ecrireValeur } from '../server/store.js';
import { creerApplicationNode as creerApplication } from '../server/index.js';
import { creerJeton } from '../server/auth.js';

const entetes = { 'Content-Type': 'application/json', cookie: `assistant_session=${creerJeton()}` };

function clientSimule(reponses) {
  const requetes = [];
  return {
    requetes,
    beta: { messages: { stream(params) {
      requetes.push(structuredClone(params));
      const reponse = reponses.shift();
      const evenements = reponse.content.flatMap((b) => [{ type: 'content_block_start', content_block: b }, { type: 'content_block_delta', delta: { type: 'text_delta', text: b.text } }]);
      return { async *[Symbol.asyncIterator]() { for (const e of evenements) yield e; }, async finalMessage() { return reponse; } };
    } } },
  };
}
const reponseTexte = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

test('réglages : cinq longueurs, trois modèles, valeurs inconnues refusées', async () => {
  await ecrireValeur('reglages', {});
  assert.deepEqual(Object.keys(CONCISIONS), ['tres_court', 'court', 'normal', 'developpe', 'tres_developpe']);
  assert.deepEqual(Object.keys(MODELES), ['auto', 'haiku', 'sonnet', 'opus']);
  for (const [k, m] of Object.entries(MODELES)) assert.ok((m.id || k === 'auto') && m.nom && m.delai && m.cout);
  assert.equal((await lireReglages()).modele, 'auto');
  await modifierReglages({ modele: 'haiku', concision: 'tres_developpe' });
  const r = await lireReglages();
  assert.equal(r.modele, 'haiku'); assert.equal(r.concision, 'tres_developpe');
  await assert.rejects(modifierReglages({ modele: 'gpt' }));
  await assert.rejects(modifierReglages({ concision: 'roman' }));
  assert.equal(modeleClaude({ modele: 'sonnet' }, 'x'), 'claude-sonnet-5-5');
  assert.equal(modeleClaude({}, 'defaut'), 'defaut');
  assert.equal(consigneConcision('inconnu'), CONCISIONS.court);
});

test('chat : le modèle choisi est utilisé ; Haiku sans fallbacks et avec web_search 20250305 ; consigne de longueur', async () => {
  await ecrireValeur('reglages', { modele: 'haiku', concision: 'tres_court' });
  const client = clientSimule([reponseTexte('Oui.'), reponseTexte('Bien sûr.')]);
  const app = creerApplication({ client, serveurs: [] });
  let r = await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Salut' }] }) });
  await r.text();
  let q = client.requetes[0];
  assert.equal(q.model, 'claude-haiku-5-5');
  assert.equal(q.fallbacks, undefined);
  assert.ok(q.tools.some((t) => t.type === 'web_search_20250305'));
  assert.match(q.messages.at(-1).content, new RegExp(`Longueur de la réponse : ${CONCISIONS.tres_court.slice(0, 15)}`));

  await ecrireValeur('reglages', { modele: 'opus', concision: 'developpe' });
  r = await app.request('/api/chat', { method: 'POST', headers: entetes, body: JSON.stringify({ content: [{ type: 'text', text: 'Raconte' }] }) });
  await r.text();
  q = client.requetes[1];
  assert.equal(q.model, 'claude-opus-5-5'); assert.equal(q.fallbacks, 'default');
  assert.ok(q.tools.some((t) => t.type === 'web_search_20260209'));

  r = await app.request('/api/reglages', { headers: entetes });
  const j = await r.json();
  assert.equal(j.modeles.sonnet.nom, 'Sonnet 5.5'); assert.ok(j.concisions.includes('tres_developpe'));
});
