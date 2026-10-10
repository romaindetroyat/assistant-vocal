// Mode conversation : GPT-Realtime (OpenAI) comme voix, Claude comme cerveau (délégation par appel de fonction).
import { config } from './config.js';
import { lireReglages, consigneConcision, CONTEXTE_VOITURE } from './reglages.js';

const env = () => (typeof process !== 'undefined' && process.env) || {};
export const voixDisponible = () => Boolean(env().OPENAI_API_KEY);
export const modeleVoix = () => env().OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini';

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

// Instructions Realtime ajoutées en mode voiture (phase 19) : la concision y est forcée au niveau « très court ».
export const CONSIGNE_VOITURE_REALTIME = "L'utilisateur conduit : phrases très courtes, confirme chaque action en trois mots, jamais de liste, pas de liens.";

export function instructionsVoix(reglages = { concision: 'court' }, { contexte = null } = {}) {
  const prenom = config.userName ? ` Ton utilisateur s'appelle ${config.userName}.` : '';
  const voiture = contexte === CONTEXTE_VOITURE;
  const concision = voiture ? 'tres_court' : reglages.concision;
  return `Tu es la voix de ${config.assistantName}, un assistant personnel.${prenom} Tu parles français, naturellement, de façon brève et chaleureuse.
Règle principale : dès que l'utilisateur demande une information, une action, ou quelque chose qui touche à son agenda, ses mails, ses messages, ses fichiers, ses rappels, ses projets ou l'actualité, appelle l'outil demander_assistant avec sa demande complète. Avant d'appeler l'outil, dis un mot court comme « je regarde » ou « d'accord ». Ne devine jamais une information que l'outil peut fournir.
Quand l'outil répond, restitue la réponse à l'oral, fidèlement, sans lire de symboles ni de mise en forme.
Longueur de tes réponses : ${consigneConcision(concision)}
Tu peux répondre directement, sans outil, aux salutations, remerciements et bavardages simples.
Si l'utilisateur t'interrompt, arrête-toi et écoute.${voiture ? `\n${CONSIGNE_VOITURE_REALTIME}` : ''}`;
}

export function configurationSession(reglages = { voix: env().OPENAI_REALTIME_VOICE || 'marin', concision: 'court' }, { contexte = null } = {}) {
  return {
    type: 'realtime',
    model: modeleVoix(),
    output_modalities: ['audio'],
    audio: {
      // Détection de tour peu empressée + réduction de bruit « champ lointain » (haut-parleur du téléphone, voiture) ;
      // la réponse n'est pas créée automatiquement : le navigateur la déclenche après avoir filtré la transcription
      // (bruits, échos et fragments ne provoquent plus de réponse).
      input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'fr' }, noise_reduction: { type: 'far_field' }, turn_detection: { type: 'semantic_vad', eagerness: 'low', create_response: false, interrupt_response: true } },
      output: { voice: reglages.voix || env().OPENAI_REALTIME_VOICE || 'marin' },
    },
    instructions: instructionsVoix(reglages, { contexte }),
    tools: [OUTIL_DELEGATION],
    tool_choice: 'auto',
  };
}

// Crée un jeton éphémère pour que le navigateur se connecte directement à OpenAI en WebRTC.
export async function creerJetonEphemere(fetchImpl = fetch, { contexte = null } = {}) {
  const reglages = await lireReglages();
  const r = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env().OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: configurationSession(reglages, { contexte }) }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.value) throw new Error(json.error?.message || `OpenAI : HTTP ${r.status}`);
  return { value: json.value, expires_at: json.expires_at || null, model: modeleVoix() };
}

// Aperçu d'une voix : court extrait généré par l'API de synthèse vocale, mis en cache côté serveur.
const TEXTE_APERCU = "Bonjour Romain, je suis votre assistant. Voici à quoi ressemble ma voix : dites-moi ce que vous souhaitez faire aujourd'hui.";
export async function apercuVoix(voix, { lireValeur, ecrireValeur }, fetchImpl = fetch) {
  const cle = `apercu-voix:${voix}`;
  const cache = await lireValeur(cle);
  if (cache?.base64) return Uint8Array.from(atob(cache.base64), (ch) => ch.charCodeAt(0));
  const r = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env().OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voix, input: TEXTE_APERCU, instructions: 'Parle en français, naturellement, chaleureusement.', response_format: 'mp3' }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error?.message || `OpenAI : HTTP ${r.status}`); }
  const octets = new Uint8Array(await r.arrayBuffer());
  let binaire = ''; for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  await ecrireValeur(cle, { base64: btoa(binaire), creeLe: new Date().toISOString() });
  return octets;
}
