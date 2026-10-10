// Partage depuis l'iPhone (raccourci iOS) ou la PWA (share_target) : un tour Claude dans la conversation « Partages »,
// réponse renvoyée à l'appelant et poussée en notification.
import { config } from './config.js';
import { listerConversations, lireConversation, creerConversation, sauverConversation } from './store.js';
import { envoyerNotification, pushDisponible } from './push.js';
import { tronquer } from './brief.js';

export const TITRE_CONVERSATION = 'Partages';
export const TYPES_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const TAILLE_MAX_IMAGE = 8 * 1024 * 1024;
export const CONSIGNE_PAR_DEFAUT = "Fais ce qui est le plus utile : résumé en trois phrases ; si une date ou un rendez-vous apparaît, propose de le créer ; si c'est une chose à faire, ajoute la tâche.";

// Texte du message utilisateur, identique côté serveur (raccourci) et côté PWA (share_target).
export function composerTexte({ texte = '', url = '', consigne = '' } = {}) {
  const lignes = ["Contenu partagé depuis l'iPhone."];
  if (url) lignes.push(`URL : ${url}`);
  if (texte) lignes.push(`Texte : ${texte}`);
  lignes.push(`Consigne : ${consigne || CONSIGNE_PAR_DEFAUT}`);
  return lignes.join('\n');
}

// Conversation « Partages » : réutilisée si elle existe, créée sinon.
export async function conversationPartages() {
  const existante = (await listerConversations()).find((c) => c.titre === TITRE_CONVERSATION);
  if (existante) { const conv = await lireConversation(existante.id).catch(() => null); if (conv) return conv; }
  const conv = await creerConversation();
  conv.titre = TITRE_CONVERSATION;
  await sauverConversation(conv);
  return conv;
}

// Valide une image { media_type, data (base64) } : type accepté par l'API et taille raisonnable.
export function validerImage(image) {
  if (!image) return null;
  const media_type = String(image.media_type || '').toLowerCase().split(';')[0].trim();
  const data = String(image.data || '');
  if (!data) return null;
  if (/heic|heif/.test(media_type)) throw Object.assign(new Error("Format HEIC non pris en charge : dans le raccourci, ajoutez l'action « Convertir l'image » en JPEG avant l'envoi."), { status: 415 });
  if (!TYPES_IMAGE.has(media_type)) throw Object.assign(new Error(`Type d'image non pris en charge : ${media_type || 'inconnu'} (JPEG, PNG, WebP ou GIF attendu)`), { status: 415 });
  if (data.length * 3 / 4 > TAILLE_MAX_IMAGE) throw Object.assign(new Error('Image trop volumineuse (8 Mo maximum)'), { status: 413 });
  return { media_type, data };
}

/**
 * Traite un partage : message [image] + texte composé dans la conversation « Partages », tour Claude avec effort voix,
 * push « Partage traité ». Retourne { texte, conversationId }.
 */
export async function traiterPartage({ client, serveurs = [], nonConnectes = [], texte = '', url = '', consigne = '', image = null, envoyer = envoyerNotification }) {
  if (!client) throw new Error('Client Anthropic absent');
  texte = String(texte || '').trim(); url = String(url || '').trim(); consigne = String(consigne || '').trim();
  const img = validerImage(image);
  if (!texte && !url && !img) throw Object.assign(new Error('Rien à partager : texte, url ou image requis'), { status: 400 });
  const { executerTour } = await import('./chat.js');
  const conversation = await conversationPartages();
  const contenu = [];
  if (img) contenu.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
  contenu.push({ type: 'text', text: composerTexte({ texte, url, consigne }) });
  let reponse = ''; let erreur = null;
  try {
    for await (const ev of executerTour({ client, conversation, contenuUtilisateur: contenu, serveurs, nonConnectes, effort: config.effortVoix, consigne: 'Réponse courte, sans mise en forme : elle sera lue à voix haute et affichée en notification.' })) {
      if (ev.type === 'done') reponse = ev.text;
      else if (ev.type === 'error') erreur = ev.message;
    }
  } finally {
    await sauverConversation(conversation);
  }
  reponse = reponse.trim();
  if (!reponse) throw new Error(erreur || 'Réponse vide');
  if (pushDisponible()) {
    try { await envoyer({ titre: 'Partage traité', corps: tronquer(reponse), url: `/app?conversation=${conversation.id}`, tag: 'partage' }); }
    catch (e) { console.warn('[partage] push impossible :', e.message); }
  }
  return { texte: reponse, conversationId: conversation.id };
}

// Lit le corps d'une requête de partage : JSON { texte, url, consigne, image } ou multipart (fichier image → base64).
export async function lireCorpsPartage(req) {
  const type = req.header('content-type') || '';
  if (type.includes('json')) {
    const corps = (await req.json().catch(() => null)) || {};
    return { texte: corps.texte, url: corps.url, consigne: corps.consigne, image: corps.image && typeof corps.image === 'object' ? corps.image : null };
  }
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  const champ = (n) => String(form.get(n) || '');
  const fichier = form.get('fichier') || form.get('fichiers');
  let image = null;
  if (fichier instanceof File) {
    if (fichier.size > TAILLE_MAX_IMAGE) throw Object.assign(new Error('Image trop volumineuse (8 Mo maximum)'), { status: 413 });
    const octets = new Uint8Array(await fichier.arrayBuffer());
    let binaire = ''; for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
    image = { media_type: fichier.type || (/\.hei[cf]$/i.test(fichier.name) ? 'image/heic' : ''), data: btoa(binaire) };
  }
  return { texte: champ('texte') || champ('text') || champ('title'), url: champ('url'), consigne: champ('consigne'), image };
}
