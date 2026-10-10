import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceTranscription, transcriptionDisponible, transcrire } from '../server/transcribe.js';

test('transcription : repli sur OpenAI avec la clé du mode conversation, indice transmis', async () => {
  delete process.env.TRANSCRIBE_URL; delete process.env.OPENAI_API_KEY;
  assert.equal(transcriptionDisponible(), false);
  await assert.rejects(() => transcrire(new File(['x'], 'a.webm')), /non configurée/);

  process.env.OPENAI_API_KEY = 'sk-test';
  assert.equal(transcriptionDisponible(), true);
  assert.equal(serviceTranscription().source, 'openai');
  const appels = [];
  const fetchImpl = async (url, options) => { appels.push({ url, options }); return { ok: true, json: async () => ({ text: ' assistant, allume ' }) }; };
  const texte = await transcrire(new File(['audio'], 'veille.mp4', { type: 'audio/mp4' }), { indice: 'assistant', fetchImpl });
  assert.equal(texte, 'assistant, allume');
  assert.equal(appels[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(appels[0].options.headers.Authorization, 'Bearer sk-test');
  const form = appels[0].options.body;
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(form.get('prompt'), 'assistant');
  assert.equal(form.get('language'), 'fr');
  assert.equal(form.get('file').name, 'veille.mp4');

  // TRANSCRIBE_URL explicite : prioritaire sur OpenAI.
  process.env.TRANSCRIBE_URL = 'https://exemple.test/v1/audio/transcriptions';
  assert.equal(serviceTranscription().source, 'TRANSCRIBE_URL');
  delete process.env.TRANSCRIBE_URL; delete process.env.OPENAI_API_KEY;
});
