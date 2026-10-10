import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compacterSiNecessaire, indexCoupure, messagesEnTexte, tailleConversation } from '../server/compaction.js';
import { executerTour } from '../server/chat.js';

// Client simulé : `create` renvoie un résumé fixe, `stream` une réponse courte ; aucun réseau.
function clientSimule(resume = 'Faits : Romain prépare un voyage à Lyon le 12 mai.\nDécision : train à 8 h.') {
  const requetes = [];
  return {
    requetes,
    beta: { messages: {
      async create(params) { requetes.push(structuredClone(params)); return { content: [{ type: 'text', text: resume }] }; },
      stream() {
        const reponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ok.' }] };
        return { async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ok.' } }; }, async finalMessage() { return reponse; } };
      },
    } },
  };
}

const texteUser = (t) => ({ role: 'user', content: [{ type: 'text', text: t }] });
const texteAssistant = (t) => ({ role: 'assistant', content: [{ type: 'text', text: t }] });

function longueConversation(tours = 30, taille = 3000) {
  const messages = [];
  for (let i = 0; i < tours; i++) {
    messages.push(texteUser(`Question ${i} ${'x'.repeat(taille)}`));
    messages.push(texteAssistant(`Réponse ${i} ${'y'.repeat(taille)}`));
  }
  return { id: 'c1', titre: 'Longue', messages };
}

test('sous le seuil : aucune compaction, aucun appel à Claude', async () => {
  const client = clientSimule();
  const conversation = { messages: [texteUser('Salut'), texteAssistant('Bonjour !')] };
  assert.equal(await compacterSiNecessaire({ client, conversation }), false);
  assert.equal(client.requetes.length, 0);
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.resumes, undefined);
});

test('au-dessus du seuil : résumé injecté, derniers messages intacts, resumes renseigné', async () => {
  const client = clientSimule();
  const conversation = longueConversation(30);
  const avant = structuredClone(conversation.messages);
  assert.ok(tailleConversation(conversation) > 120_000);
  assert.equal(await compacterSiNecessaire({ client, conversation }), true);

  // Les 6 derniers messages sont conservés tels quels, précédés du résumé et de l'accusé de réception.
  assert.equal(conversation.messages.length, 8);
  assert.deepEqual(conversation.messages.slice(2), avant.slice(-6));
  assert.equal(conversation.messages[0].role, 'user');
  assert.match(conversation.messages[0].content[0].text, /^\[Résumé de la conversation précédente\]\nFaits : Romain/);
  assert.equal(conversation.messages[1].role, 'assistant');
  assert.equal(conversation.messages[1].content[0].text, 'Compris, je poursuis avec ce contexte.');
  assert.ok(tailleConversation(conversation) < 120_000);

  assert.equal(conversation.resumes.length, 1);
  assert.equal(conversation.resumes[0].messagesCompactes, 54);
  assert.match(conversation.resumes[0].texte, /Lyon/);
  assert.match(conversation.resumes[0].date, /^\d{4}-\d{2}-\d{2}T/);

  // Requête de résumé : modèle, effort bas, sans outils, pas de budget ni de prefill.
  const req = client.requetes[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.deepEqual(req.output_config, { effort: 'low' });
  assert.equal(req.max_tokens, 3000);
  assert.equal(req.tools, undefined);
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, 'user');
  assert.match(req.messages[0].content, /Question 0/);
  assert.ok(!req.messages[0].content.includes('Question 29'), 'les messages conservés ne sont pas résumés');
});

test('la coupure ne sépare jamais un tool_use de ses tool_result', async () => {
  const messages = [];
  for (let i = 0; i < 10; i++) { messages.push(texteUser(`Q${i} ${'x'.repeat(4000)}`)); messages.push(texteAssistant(`R${i} ${'y'.repeat(4000)}`)); }
  // Dernier tour avec deux appels d'outils enchaînés : user, assistant(tool_use), user(tool_result), assistant(tool_use), user(tool_result), assistant(texte)
  messages.push(texteUser('Mes rappels et mes mails ?'));
  messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'list_reminders', input: {} }] });
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'aucun' }] });
  messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'gmail_lister', input: { compte: 'a' } }] });
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: '3 mails' }] });
  messages.push(texteAssistant('Aucun rappel, trois mails.'));
  messages.push(texteUser('Merci'));
  messages.push(texteAssistant('De rien.'));
  // Les 6 derniers commencent sur un user de tool_result : la coupure doit reculer jusqu'à « Mes rappels… ».
  assert.equal(indexCoupure(messages), 20);
  assert.equal(messages[20].content[0].text, 'Mes rappels et mes mails ?');

  const client = clientSimule();
  const conversation = { messages: structuredClone(messages) };
  assert.equal(await compacterSiNecessaire({ client, conversation, seuil: 1000 }), true);
  assert.equal(conversation.messages.length, 2 + 8);
  assert.equal(conversation.resumes[0].messagesCompactes, 20);
  for (let i = 0; i < conversation.messages.length; i++) {
    const m = conversation.messages[i];
    if (m.role === 'user' && m.content.every((b) => b.type === 'tool_result')) {
      const ids = conversation.messages[i - 1].content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      for (const b of m.content) assert.ok(ids.includes(b.tool_use_id), `tool_result ${b.tool_use_id} orphelin`);
    }
  }
});

test('texte du résumé : outils, aperçu des résultats à 200 caractères, images et thinking ignorés', () => {
  const texte = messagesEnTexte([
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'AAA' } }, { type: 'text', text: 'Que vois-tu ?' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'tool_use', id: 't', name: 'memoire_chercher', input: { q: 'chat' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'z'.repeat(500) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Un chat.' }] },
  ]);
  assert.match(texte, /^Utilisateur : \[image\] Que vois-tu \?$/m);
  assert.match(texte, /Assistant : \[appel de l'outil memoire_chercher : \{"q":"chat"\}\]/);
  assert.match(texte, /\[résultat d'outil : z{200}…\]/);
  assert.ok(!texte.includes('secret'));
  assert.ok(!texte.includes('AAA'));
});

test('executerTour : compaction avant le tour, événement compaction émis, erreur de résumé tolérée', async () => {
  process.env.COMPACTION_SEUIL = '2000';
  try {
    const client = clientSimule('Résumé court.');
    const conversation = longueConversation(4, 300);
    const evts = [];
    for await (const e of executerTour({ client, conversation, contenuUtilisateur: [{ type: 'text', text: 'Suite' }], serveurs: [], outilsLocaux: [] })) evts.push(e);
    assert.deepEqual(evts.map((e) => e.type), ['compaction', 'text', 'done']);
    assert.equal(evts[0].messages, 2);
    assert.equal(conversation.messages.at(-2).content[0].text, 'Suite');
    assert.equal(conversation.resumes.length, 1);

    // Le résumé échoue : le tour se poursuit sans compaction.
    const clientKo = clientSimule(); clientKo.beta.messages.create = async () => { throw new Error('panne'); };
    const conv2 = longueConversation(4, 300);
    const evts2 = [];
    for await (const e of executerTour({ client: clientKo, conversation: conv2, contenuUtilisateur: [{ type: 'text', text: 'Suite' }], serveurs: [], outilsLocaux: [] })) evts2.push(e);
    assert.deepEqual(evts2.map((e) => e.type), ['text', 'done']);
    assert.equal(conv2.messages.length, 10);
  } finally { delete process.env.COMPACTION_SEUIL; }
});
