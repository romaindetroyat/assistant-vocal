// Mode conversation (public/conversation.js) : micro coupé pendant la recherche, rouvert après la lecture de la réponse.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Navigateur simulé : piste micro, RTCPeerConnection et canal de données minimalistes.
function navigateurSimule() {
  const piste = { kind: 'audio', enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
  const flux = { getTracks: () => [piste], getAudioTracks: () => [piste] };
  const canal = { readyState: 'open', envoyes: [], send(t) { this.envoyes.push(JSON.parse(t)); }, close() {} };
  globalThis.RTCPeerConnection = class { addTrack() {} createDataChannel() { return canal; } async createOffer() { return { sdp: 'v=0' }; } async setLocalDescription() {} async setRemoteDescription() {} close() {} };
  globalThis.document = { createElement: () => ({ play: async () => {} }), body: { append() {} } };
  globalThis.fetch = async () => ({ ok: true, text: async () => 'v=0' });
  return { piste, flux, canal };
}
const attendre = () => new Promise((r) => setTimeout(r, 0));

test('le micro est coupé dès que la recherche part, rouvert quand la réponse a été lue ; rendu actif en raccrochant', async () => {
  const { piste, flux, canal } = navigateurSimule();
  const { creerConversationVocale } = await import('../public/conversation.js');
  let reponseAsk; const etats = [];
  const api = async (chemin) => {
    if (chemin === '/api/voice/session') return { conversationId: 'c1', model: 'm', value: 'v' };
    return new Promise((r) => { reponseAsk = r; });
  };
  const appel = creerConversationVocale({ api, surEtat: (t) => etats.push(t), surTexteUtilisateur() {}, surTexteAssistant() {}, surOutils() {}, surFin() {}, conserverFlux: () => true });
  await appel.demarrer(null, { flux });
  canal.onopen();
  const recevoir = (ev) => canal.onmessage({ data: JSON.stringify(ev) });

  recevoir({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', name: 'demander_assistant', call_id: 'a', arguments: '{"message":"météo"}' }] } });
  await attendre();
  assert.equal(piste.enabled, false, 'micro coupé pendant la recherche');
  assert.equal(appel.microCoupe, true);
  assert.match(etats.at(-1), /micro coupé/);

  reponseAsk({ text: 'Il fera beau.' }); await attendre(); await attendre();
  assert.equal(piste.enabled, false, 'toujours coupé pendant la lecture');
  assert.ok(canal.envoyes.some((e) => e.type === 'conversation.item.create' && e.item.type === 'function_call_output'));

  recevoir({ type: 'output_audio_buffer.stopped' });
  assert.equal(piste.enabled, true, 'rouvert après la lecture');

  // Nouvelle recherche puis raccrochage en plein milieu : la piste (micro partagé) n'est jamais rendue désactivée.
  recevoir({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', name: 'demander_assistant', call_id: 'b', arguments: '{}' }] } });
  await attendre();
  assert.equal(piste.enabled, false);
  appel.arreter('Micro coupé');
  assert.equal(piste.enabled, true);
});

test('couper la parole rouvre le micro', async () => {
  const { piste, flux, canal } = navigateurSimule();
  const { creerConversationVocale } = await import('../public/conversation.js');
  const api = async (chemin) => (chemin === '/api/voice/session' ? { conversationId: 'c2', model: 'm', value: 'v' } : { text: 'ok' });
  const appel = creerConversationVocale({ api, surEtat() {}, surTexteUtilisateur() {}, surTexteAssistant() {}, surOutils() {}, surFin() {}, conserverFlux: () => true });
  await appel.demarrer(null, { flux });
  canal.onopen();
  canal.onmessage({ data: JSON.stringify({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', name: 'demander_assistant', call_id: 'x', arguments: '{}' }] } }) });
  assert.equal(piste.enabled, false);
  appel.interrompre();
  assert.equal(piste.enabled, true);
  assert.ok(canal.envoyes.some((e) => e.type === 'response.cancel'));
  appel.arreter();
});

test('le bruit ambiant ne prolonge pas l\'appel : fin automatique malgré des détections de parole sans texte valable', async () => {
  const { flux, canal } = navigateurSimule();
  const { creerConversationVocale } = await import('../public/conversation.js');
  const api = async () => ({ conversationId: 'c3', model: 'm', value: 'v' });
  let fin = null;
  const appel = creerConversationVocale({ api, surEtat() {}, surTexteUtilisateur() {}, surTexteAssistant() {}, surOutils() {}, surFin: (r) => { fin = r; }, delaiInactivite: () => 60, conserverFlux: () => true });
  await appel.demarrer(null, { flux });
  canal.onopen();
  const bruit = setInterval(() => {
    canal.onmessage({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) });
    canal.onmessage({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'euh', item_id: 'i' }) });
  }, 20);
  await new Promise((r) => setTimeout(r, 150));
  clearInterval(bruit);
  assert.equal(appel.actif, false, 'appel terminé');
  assert.match(fin, /silence/);
});

test('raccrocher pendant la connexion : le micro n\'est jamais ouvert ensuite', async () => {
  navigateurSimule();
  let demandes = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { demandes++; return { getTracks: () => [], getAudioTracks: () => [] }; } } } });
  const { creerConversationVocale } = await import('../public/conversation.js');
  let libererSession;
  const api = () => new Promise((r) => { libererSession = r; });
  const appel = creerConversationVocale({ api, surEtat() {}, surTexteUtilisateur() {}, surTexteAssistant() {}, surOutils() {}, surFin() {} });
  const demarrage = appel.demarrer(null); // sans flux fourni : la conversation ouvrirait son propre micro
  appel.arreter('Écoute arrêtée');
  libererSession({ conversationId: 'c4', model: 'm', value: 'v' });
  await demarrage;
  assert.equal(demandes, 0, 'aucune demande de micro après l\'arrêt');
  assert.equal(appel.actif, false);
});

test('fin de phrase : la réponse attend un silence, et attend la suite si l\'utilisateur reprend la parole', async () => {
  const { flux, canal } = navigateurSimule();
  const { creerConversationVocale } = await import('../public/conversation.js');
  const api = async () => ({ conversationId: 'c5', model: 'm', value: 'v' });
  const appel = creerConversationVocale({ api, surEtat() {}, surTexteUtilisateur() {}, surTexteAssistant() {}, surOutils() {}, surFin() {}, conserverFlux: () => true });
  await appel.demarrer(null, { flux });
  canal.onopen();
  const recevoir = (ev) => canal.onmessage({ data: JSON.stringify(ev) });
  const reponses = () => canal.envoyes.filter((e) => e.type === 'response.create').length;
  recevoir({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Rappelle-moi demain de' });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(reponses(), 0, 'phrase inachevée : on attend encore');
  recevoir({ type: 'input_audio_buffer.speech_started' }); // il reprend
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(reponses(), 0, 'reprise de parole : pas de réponse');
  recevoir({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'appeler le garage.' });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(reponses(), 1, 'une seule réponse, pour la demande complète');
  appel.arreter();
});
