// Transcription d'un enregistrement vocal via un service HTTP compatible /v1/audio/transcriptions (multipart).
import { config } from './config.js';

export function transcriptionDisponible() {
  return Boolean(config.transcribe.url);
}

export async function transcrire(fichier, { langue = 'fr' } = {}) {
  if (!transcriptionDisponible()) {
    const e = new Error('Transcription non configurée (TRANSCRIBE_URL)');
    e.status = 501;
    throw e;
  }
  const form = new FormData();
  form.append('file', fichier, fichier.name || 'audio.webm');
  if (config.transcribe.model) form.append('model', config.transcribe.model);
  form.append('language', langue);
  form.append('response_format', 'json');
  const reponse = await fetch(config.transcribe.url, {
    method: 'POST',
    headers: config.transcribe.apiKey ? { Authorization: `Bearer ${config.transcribe.apiKey}` } : {},
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
