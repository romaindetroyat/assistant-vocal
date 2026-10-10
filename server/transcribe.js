// Transcription d'un enregistrement vocal via un service HTTP compatible /v1/audio/transcriptions (multipart).
// Sans TRANSCRIBE_URL, on se rabat sur OpenAI (gpt-4o-mini-transcribe) si OPENAI_API_KEY est présent : la même clé
// que le mode conversation suffit donc pour les vocaux et la veille mains libres.
import { config } from './config.js';

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MODELE = 'gpt-4o-mini-transcribe';

export function serviceTranscription(env = process.env) {
  if (config.transcribe.url) return { url: config.transcribe.url, apiKey: config.transcribe.apiKey, model: config.transcribe.model, source: 'TRANSCRIBE_URL' };
  if (env.OPENAI_API_KEY) return { url: OPENAI_URL, apiKey: env.OPENAI_API_KEY, model: OPENAI_MODELE, source: 'openai' };
  return null;
}

export function transcriptionDisponible() {
  return Boolean(serviceTranscription());
}

// `indice` : mots attendus (ex. le mot d'activation) pour guider la transcription ; `fetchImpl` injectable pour les tests.
export async function transcrire(fichier, { langue = 'fr', indice = '', fetchImpl = fetch } = {}) {
  const service = serviceTranscription();
  if (!service) {
    const e = new Error('Transcription non configurée (TRANSCRIBE_URL ou OPENAI_API_KEY)');
    e.status = 501;
    throw e;
  }
  const form = new FormData();
  form.append('file', fichier, fichier.name || 'audio.webm');
  if (service.model) form.append('model', service.model);
  form.append('language', langue);
  form.append('response_format', 'json');
  if (indice) form.append('prompt', String(indice).slice(0, 200));
  const reponse = await fetchImpl(service.url, {
    method: 'POST',
    headers: service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {},
    body: form,
  });
  if (!reponse.ok) {
    const e = new Error(`Service de transcription : HTTP ${reponse.status}`);
    e.status = 502;
    throw e;
  }
  const json = await reponse.json();
  if (typeof json.text !== 'string') throw new Error('Réponse de transcription sans champ "text"');
  return json.text.trim();
}
