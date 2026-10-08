// Mode conversation : GPT-Realtime (OpenAI) comme voix, Claude comme cerveau (délégation par appel de fonction).
import { config } from './config.js';

const env = () => (typeof process !== 'undefined' && process.env) || {};
export const voixDisponible = () => Boolean(env().OPENAI_API_KEY);
export const modeleVoix = () => env().OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini';
const voix = () => env().OPENAI_REALTIME_VOICE || 'marin';

export const OUTIL_DELEGATION = {
  type: 'function',
  name: 'demander_assistant',
  description: "Transmet la demande de l'utilisateur à l'assistant principal, qui a accès à ses outils (agenda, e-mails, messages, rappels, notifications, recherche web, documents) et à l'historique. À appeler pour toute demande d'information ou d'action ; la réponse est à restituer à l'oral telle quelle, en la raccourcissant si elle est longue.",
  parameters: {
    type: 'object',
    properties: { message: { type: 'string', description: "La demande de l'utilisateur, reformulée fidèlement et complètement (avec les noms, dates et détails donnés)." } },
    required: ['message'],
  },
};

export function instructionsVoix() {
  const prenom = config.userName ? ` Ton utilisateur s'appelle ${config.userName}.` : '';
  return `Tu es la voix de ${config.assistantName}, un assistant personnel.${prenom} Tu parles français, naturellement, de façon brève et chaleureuse.
Règle principale : dès que l'utilisateur demande une information, une action, ou quelque chose qui touche à son agenda, ses mails, ses messages, ses fichiers, ses rappels, ses projets ou l'actualité, appelle l'outil demander_assistant avec sa demande complète. Avant d'appeler l'outil, dis un mot court comme « je regarde » ou « d'accord ». Ne devine jamais une information que l'outil peut fournir.
Quand l'outil répond, restitue la réponse à l'oral, fidèlement, en la condensant si elle est longue, sans lire de symboles ni de mise en forme.
Tu peux répondre directement, sans outil, aux salutations, remerciements et bavardages simples.
Si l'utilisateur t'interrompt, arrête-toi et écoute.`;
}

export function configurationSession() {
  return {
    type: 'realtime',
    model: modeleVoix(),
    output_modalities: ['audio'],
    audio: {
      input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'fr' }, turn_detection: { type: 'semantic_vad', eagerness: 'medium' } },
      output: { voice: voix() },
    },
    instructions: instructionsVoix(),
    tools: [OUTIL_DELEGATION],
    tool_choice: 'auto',
  };
}

// Crée un jeton éphémère pour que le navigateur se connecte directement à OpenAI en WebRTC.
export async function creerJetonEphemere(fetchImpl = fetch) {
  const r = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env().OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: configurationSession() }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.value) throw new Error(json.error?.message || `OpenAI : HTTP ${r.status}`);
  return { value: json.value, expires_at: json.expires_at || null, model: modeleVoix() };
}
