// Notifications Web Push (VAPID).
import webpush from 'web-push';
import { config } from './config.js';
import { listerAbonnements, retirerAbonnement } from './store.js';

export function pushDisponible() {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}

let initialise = false;
function initialiser() {
  if (initialise || !pushDisponible()) return;
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  initialise = true;
}

// Envoie une notification à tous les appareils abonnés. Retourne le nombre de livraisons réussies.
export async function envoyerNotification({ titre, corps, url = '/', tag }) {
  if (!pushDisponible()) throw new Error('Notifications push non configurées (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
  initialiser();
  const abonnements = await listerAbonnements();
  const charge = JSON.stringify({ titre, corps, url, tag: tag || `assistant-${Date.now()}` });
  let reussites = 0;
  for (const abo of abonnements) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: abo.keys }, charge, { TTL: 3600 });
      reussites++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await retirerAbonnement(abo.endpoint);
      else console.warn('[push] échec', e.statusCode || e.message);
    }
  }
  return reussites;
}
