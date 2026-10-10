// Raccourci Siri « Demande à l'assistant » : un texte dicté arrive avec un jeton d'appareil, un tour Claude répond
// en une ou deux phrases que Siri énonce. Conversation « Siri » glissante (30 min) pour garder le fil d'une question à
// l'autre. Raccourcis coupe la requête vers 30 s : au-delà de 20 s, on répond une phrase d'attente et la vraie
// réponse arrive en notification quand le tour se termine en arrière-plan.
import { config } from './config.js';
import { listerConversations, lireConversation, creerConversation, sauverConversation } from './store.js';
import { envoyerNotification, pushDisponible } from './push.js';
import { lireReglages, consigneConcision } from './reglages.js';
import { tronquer } from './brief.js';

export const TITRE_CONVERSATION = 'Siri';
export const FENETRE_MS = 30 * 60 * 1000;
export const DELAI_MS = 20_000;
export const REPONSE_ATTENTE = "Je continue et je t'envoie la réponse en notification.";
export const CONSIGNE_SIRI = 'Réponse énoncée par Siri : une à deux phrases, pas de mise en forme, pas de liens.';

// Position transmise par le raccourci : { lat, lng } (ou { latitude, longitude }) → « lat, lng » ; texte libre accepté.
export function formaterPosition(position) {
  if (!position) return null;
  if (typeof position === 'string') return position.trim().slice(0, 120) || null;
  const lat = Number(position.lat ?? position.latitude); const lng = Number(position.lng ?? position.lon ?? position.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// Conversation « Siri » : réutilisée si son dernier échange date de moins de 30 min, sinon nouvelle (l'ancienne reste visible).
export async function conversationSiri(maintenant = new Date()) {
  const recente = (await listerConversations()).find((c) => c.titre === TITRE_CONVERSATION && maintenant.getTime() - new Date(c.modifieLe).getTime() < FENETRE_MS);
  if (recente) { const conv = await lireConversation(recente.id).catch(() => null); if (conv) return conv; }
  const conv = await creerConversation();
  conv.titre = TITRE_CONVERSATION;
  await sauverConversation(conv);
  return conv;
}

/**
 * Répond à un texte dicté via Siri. Retourne { texte, conversationId, enAttente }.
 * - `attendre(promesse)` : sur Workers, `c.executionCtx.waitUntil` pour laisser le tour finir après la réponse ; sinon promesse flottante.
 * - `delaiMs`, `maintenant`, `envoyer` : injectables pour les tests.
 */
export async function repondreRaccourci({ client, serveurs = [], nonConnectes = [], texte = '', position = null, envoyer = envoyerNotification, attendre = null, delaiMs = DELAI_MS, maintenant = new Date() }) {
  if (!client) throw new Error('Client Anthropic absent');
  texte = String(texte || '').trim();
  if (!texte) throw Object.assign(new Error('texte requis'), { status: 400 });
  const { executerTour } = await import('./chat.js');
  const conversation = await conversationSiri(maintenant);
  const reglages = await lireReglages().catch(() => ({}));
  const lieu = formaterPosition(position);
  const consigne = [CONSIGNE_SIRI, consigneConcision(reglages.concision), lieu ? `Position actuelle de l'utilisateur : ${lieu}.` : ''].filter(Boolean).join(' ');

  const tour = (async () => {
    let reponse = ''; let erreur = null;
    try {
      for await (const ev of executerTour({ source: 'siri',  client, conversation, contenuUtilisateur: [{ type: 'text', text: texte }], serveurs, nonConnectes, effort: config.effortVoix, consigne })) {
        if (ev.type === 'done') reponse = ev.text;
        else if (ev.type === 'error') erreur = ev.message;
      }
    } catch (e) {
      erreur = e.message;
    } finally {
      await sauverConversation(conversation);
    }
    reponse = reponse.trim();
    if (!reponse) throw new Error(erreur || 'Réponse vide');
    return reponse;
  })();

  let minuteur = null;
  const delai = new Promise((resoudre) => { minuteur = setTimeout(() => resoudre(Symbol.for('delai')), delaiMs); });
  const resultat = await Promise.race([tour.then((t) => ({ texte: t }), (e) => ({ erreur: e })), delai]);
  clearTimeout(minuteur);
  if (resultat && typeof resultat === 'object') {
    if (resultat.erreur) throw resultat.erreur;
    return { texte: resultat.texte, conversationId: conversation.id, enAttente: false };
  }

  // Délai dépassé : Siri énonce la phrase d'attente ; la réponse complète partira en notification.
  const suite = tour
    .then((reponse) => notifier(envoyer, reponse, conversation.id), (e) => notifier(envoyer, `Désolé, je n'ai pas pu répondre : ${e.message}`, conversation.id))
    .catch((e) => console.warn('[raccourci] push impossible :', e.message));
  if (typeof attendre === 'function') attendre(suite);
  return { texte: REPONSE_ATTENTE, conversationId: conversation.id, enAttente: true };
}

async function notifier(envoyer, texte, conversationId) {
  if (!pushDisponible()) { console.warn('[raccourci] réponse différée sans push configuré :', tronquer(texte, 80)); return; }
  await envoyer({ titre: "Réponse de l'assistant", corps: tronquer(texte), url: `/app?conversation=${conversationId}`, tag: 'raccourci' });
}
